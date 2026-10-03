package com.allvest.supportify;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.TimeUnit;

/** JS bridge: window.Capacitor.Plugins.CallLogSync (called by the Supportify web app inside this shell). */
@CapacitorPlugin(
        name = "CallLogSync",
        permissions = { @Permission(alias = "callLog", strings = { Manifest.permission.READ_CALL_LOG }) })
public class CallLogSyncPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        SyncStore store = new SyncStore(getContext());
        JSObject ret = new JSObject();
        ret.put("hasToken", store.hasToken());
        ret.put("hasPermission", CallLogSyncer.hasPermission(getContext()));
        ret.put("deviceId", store.deviceId());
        ret.put("lastSyncAt", store.lastSyncAt() > 0 ? store.lastSyncAt() : null);
        ret.put("appVersion", CallLogSyncer.appVersion(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (CallLogSyncer.hasPermission(getContext())) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("callLog", call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("callLog") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String token = call.getString("token");
        String deviceId = call.getString("deviceId");
        String baseUrl = call.getString("baseUrl");
        if (token == null || deviceId == null || baseUrl == null) {
            call.reject("token, deviceId and baseUrl are required");
            return;
        }
        new SyncStore(getContext()).save(token, deviceId, baseUrl.replaceAll("/+$", ""));
        call.resolve();
    }

    @PluginMethod
    public void schedulePeriodic(PluginCall call) {
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(CallSyncWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(CallSyncWorker.UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
        call.resolve();
    }

    @PluginMethod
    public void syncNow(PluginCall call) {
        new Thread(() -> {
            CallLogSyncer.Result result = CallLogSyncer.syncOnce(getContext());
            JSObject ret = new JSObject();
            ret.put("ok", result.outcome == CallLogSyncer.Outcome.OK);
            ret.put("matched", result.matched);
            call.resolve(ret);
        }).start();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        WorkManager.getInstance(getContext()).cancelUniqueWork(CallSyncWorker.UNIQUE_NAME);
        new SyncStore(getContext()).clear();
        call.resolve();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // App opened/returned to foreground: catch up straight away (background worker covers the rest).
        new Thread(() -> CallLogSyncer.syncOnce(getContext())).start();
    }
}
