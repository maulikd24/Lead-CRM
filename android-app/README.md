# Supportify Android app

A Capacitor shell that loads the live Supportify site and adds one native feature: **call-log sync**
(`CallLogSyncPlugin`). Calls whose number matches one of the signed-in user's clients are uploaded to
`/api/device/call-log` and appear in the client's Activity; every other call is discarded server-side.

The web app talks to the plugin through `window.Capacitor.Plugins.CallLogSync` (see `src/lib/device/plugin.ts`).

## Building

There is no local Android toolchain requirement. Builds run in GitHub Actions
(`.github/workflows/android-apk.yml`): Actions -> **Build Android APK** -> Run workflow. The signed APK is
committed to `public/downloads/supportify.apk` and served by the next Vercel deploy.

## One-time signing setup

The signing key is the app's identity: if it is lost, future builds cannot update installed apps.

```bash
mkdir -p ~/supportify-android-signing && cd ~/supportify-android-signing
PASS="$(openssl rand -base64 24 | tr -d '/+=')"
openssl req -x509 -newkey rsa:2048 -sha256 -days 10000 -nodes \
  -keyout key.pem -out cert.pem -subj "/CN=Supportify/O=Allvest/C=IN"
openssl pkcs12 -export -inkey key.pem -in cert.pem -name supportify -passout "pass:$PASS" -out supportify.keystore
rm key.pem cert.pem
echo "ANDROID_KEYSTORE_PASSWORD = $PASS"     # save this in a password manager
echo "ANDROID_KEY_ALIAS         = supportify"
base64 < supportify.keystore | pbcopy         # paste as ANDROID_KEYSTORE_BASE64
```

Add the three values as repository secrets, and back up `supportify.keystore` + the password somewhere safe.

## Changing the server address

`capacitor.config.json` -> `server.url` is baked into the APK. If the site moves to another domain, change it
and rebuild.

## Phone push notifications (Firebase)

Server alerts reach the phone through Firebase Cloud Messaging.

1. <https://console.firebase.google.com> -> Add project (Analytics not needed).
2. Project overview -> **Add app -> Android**, package name `com.allvest.supportify`, register, download
   `google-services.json`. Skip the remaining SDK steps.
3. `base64 < ~/Downloads/google-services.json | pbcopy` -> GitHub repository secret **`GOOGLE_SERVICES_JSON`**.
4. Firebase -> Project settings -> **Service accounts** -> *Generate new private key* (downloads a JSON).
   Put its full contents in the Vercel environment variable **`FIREBASE_SERVICE_ACCOUNT_JSON`** (mark it
   Sensitive), then redeploy. Delete the downloaded key file afterwards.
5. Re-run **Build Android APK**, install the new APK over the old one, sign in, allow notifications, then use
   Settings -> Phone notifications -> **Send test notification**.

`google-services.json` is written into `android-app/android/app/` by the workflow and is git-ignored.
