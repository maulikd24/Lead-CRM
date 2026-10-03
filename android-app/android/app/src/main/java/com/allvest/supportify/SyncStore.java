package com.allvest.supportify;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

/** Holds the per-device sync token (encrypted at rest) plus the call-log watermark. */
final class SyncStore {
    private static final String FILE = "supportify_call_sync";
    private final SharedPreferences prefs;

    SyncStore(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences p;
        try {
            MasterKey key = new MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
            p = EncryptedSharedPreferences.create(
                    app,
                    FILE,
                    key,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        } catch (Exception e) {
            // Keystore problems on a few devices: fall back to private (app-sandboxed) prefs rather than breaking sync.
            Log.w("SyncStore", "Encrypted prefs unavailable, using plain private prefs", e);
            p = app.getSharedPreferences(FILE + "_plain", Context.MODE_PRIVATE);
        }
        prefs = p;
    }

    String token() { return prefs.getString("token", null); }
    String deviceId() { return prefs.getString("deviceId", null); }
    String baseUrl() { return prefs.getString("baseUrl", null); }
    long watermark() { return prefs.getLong("watermark", 0L); }
    long lastSyncAt() { return prefs.getLong("lastSyncAt", 0L); }
    boolean hasToken() { return token() != null && baseUrl() != null; }

    void save(String token, String deviceId, String baseUrl) {
        prefs.edit().putString("token", token).putString("deviceId", deviceId).putString("baseUrl", baseUrl).putLong("watermark", 0L).apply();
    }

    void setWatermark(long value) { prefs.edit().putLong("watermark", value).apply(); }
    void markSynced() { prefs.edit().putLong("lastSyncAt", System.currentTimeMillis()).apply(); }
    void clear() { prefs.edit().clear().apply(); }
}
