package com.allvest.supportify;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Background call-log sync, scheduled by WorkManager roughly every 15 minutes while online. */
public class CallSyncWorker extends Worker {
    static final String UNIQUE_NAME = "supportify-call-log-sync";

    public CallSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        CallLogSyncer.Result result = CallLogSyncer.syncOnce(getApplicationContext());
        return result.outcome == CallLogSyncer.Outcome.TRANSIENT_FAILURE ? Result.retry() : Result.success();
    }
}
