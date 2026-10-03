package com.allvest.supportify;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.CallLog;

import androidx.core.content.ContextCompat;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Reads the device call log newer than the stored watermark and uploads it in batches. The server keeps
 * only calls that match one of the user's clients and discards the rest. The watermark advances only after
 * a batch is accepted, and the server de-duplicates, so retries are always safe.
 */
final class CallLogSyncer {
    enum Outcome { OK, NOT_CONFIGURED, AUTH_FAILED, TRANSIENT_FAILURE }

    static final class Result {
        final Outcome outcome;
        final int matched;
        Result(Outcome outcome, int matched) { this.outcome = outcome; this.matched = matched; }
    }

    private static final Object LOCK = new Object();
    private static final long BACKFILL_MS = 30L * 24 * 60 * 60 * 1000;
    private static final int BATCH_SIZE = 200;

    private CallLogSyncer() {}

    static boolean hasPermission(Context context) {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED;
    }

    static String appVersion(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "unknown";
        }
    }

    private static String typeName(int type) {
        switch (type) {
            case CallLog.Calls.INCOMING_TYPE: return "INCOMING";
            case CallLog.Calls.OUTGOING_TYPE: return "OUTGOING";
            case CallLog.Calls.MISSED_TYPE: return "MISSED";
            case CallLog.Calls.REJECTED_TYPE: return "REJECTED";
            default: return "OTHER";
        }
    }

    static Result syncOnce(Context context) {
        synchronized (LOCK) {
            SyncStore store = new SyncStore(context);
            if (!store.hasToken() || !hasPermission(context)) return new Result(Outcome.NOT_CONFIGURED, 0);

            long now = System.currentTimeMillis();
            long since = store.watermark() > 0 ? store.watermark() : now - BACKFILL_MS;
            int matchedTotal = 0;

            try (Cursor cursor = context.getContentResolver().query(
                    CallLog.Calls.CONTENT_URI,
                    new String[] { CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION },
                    CallLog.Calls.DATE + " >= ?",
                    new String[] { String.valueOf(since) },
                    CallLog.Calls.DATE + " ASC")) {

                if (cursor == null) return new Result(Outcome.TRANSIENT_FAILURE, 0);
                JSONArray batch = new JSONArray();
                long batchMaxDate = since;

                while (cursor.moveToNext()) {
                    String number = cursor.getString(0);
                    long date = cursor.getLong(2);
                    JSONObject call = new JSONObject();
                    call.put("number", number == null ? "" : number);
                    call.put("type", typeName(cursor.getInt(1)));
                    call.put("date", date);
                    call.put("duration", Math.max(0L, cursor.getLong(3)));
                    batch.put(call);
                    batchMaxDate = Math.max(batchMaxDate, date);

                    if (batch.length() >= BATCH_SIZE) {
                        Result r = upload(context, store, batch, batchMaxDate);
                        if (r.outcome != Outcome.OK) return r;
                        matchedTotal += r.matched;
                        batch = new JSONArray();
                    }
                }
                if (batch.length() > 0) {
                    Result r = upload(context, store, batch, batchMaxDate);
                    if (r.outcome != Outcome.OK) return r;
                    matchedTotal += r.matched;
                }
            } catch (Exception e) {
                return new Result(Outcome.TRANSIENT_FAILURE, matchedTotal);
            }

            store.markSynced();
            return new Result(Outcome.OK, matchedTotal);
        }
    }

    private static Result upload(Context context, SyncStore store, JSONArray calls, long maxDate) {
        HttpURLConnection connection = null;
        try {
            JSONObject body = new JSONObject();
            body.put("appVersion", appVersion(context));
            body.put("calls", calls);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);

            connection = (HttpURLConnection) new URL(store.baseUrl() + "/api/device/call-log").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + store.token());
            try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }

            int code = connection.getResponseCode();
            if (code == 401) {
                // Token revoked or user deactivated: stop syncing until the user re-enables it.
                WorkManager.getInstance(context).cancelUniqueWork(CallSyncWorker.UNIQUE_NAME);
                store.clear();
                return new Result(Outcome.AUTH_FAILED, 0);
            }
            if (code < 200 || code >= 300) return new Result(Outcome.TRANSIENT_FAILURE, 0);

            int matched = 0;
            try (InputStream in = connection.getInputStream()) {
                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                byte[] chunk = new byte[1024];
                int n;
                while ((n = in.read(chunk)) != -1) buffer.write(chunk, 0, n);
                matched = new JSONObject(buffer.toString("UTF-8")).optInt("matched", 0);
            } catch (Exception ignored) {
                // Response body is informational only.
            }
            store.setWatermark(maxDate);
            return new Result(Outcome.OK, matched);
        } catch (Exception e) {
            return new Result(Outcome.TRANSIENT_FAILURE, 0);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
