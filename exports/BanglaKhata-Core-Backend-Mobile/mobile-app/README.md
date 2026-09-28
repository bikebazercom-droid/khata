# বাংলাখাতা — নেটিভ Android Studio প্রজেক্ট

এটি **React Native/Expo-এর জেনারেট করা নেটিভ Android Gradle প্রজেক্ট**, WebView নয়। **Expo Go লাগবে না।** `mobile/android/` ফোল্ডার Android Studio-তে খুলে APK তৈরি করা যায়। অ্যাপের JavaScript ও ছবি *release APK-এর ভেতরেই* প্যাক হয়; ফোনে চালানোর জন্য Metro সার্ভার লাগে না। ফোনে ইন্টারনেট থাকলে অ্যাপ সরাসরি প্রকাশিত বাংলাখাতা API-তে এন্ট্রি পাঠায়; সার্ভার/ডাটাবেস APK-এর মধ্যে নেই।

## এই ZIP-এ কী আছে

- `mobile/android/` — আসল Kotlin/Java Android সোর্স, Gradle wrapper/JAR, অ্যাপ আইকন ও অ্যান্ড্রয়েড রিসোর্স।
- `mobile/app/`, `mobile/lib/`, `mobile/assets/` — বিদ্যমান BanglaKhata Mobile-এর নেটিভ React Native পর্দা, ক্যামেরা থেকে বিল ছবি, খাতা ও লেনদেন, রিপোর্ট/PDF, live updates, ফোন/Clerk সাইন-ইন।
- `lib/api-client-react/` — অ্যাপের প্রয়োজনীয় স্বয়ংসম্পূর্ণ শেয়ার্ড API ক্লায়েন্ট।
- `pnpm-lock.yaml`, `pnpm-workspace.yaml` — বাইরের মূল প্রজেক্ট ছাড়াই নির্ভরতা ইনস্টলের জন্য।
- `mobile/public-build.json` — **পাবলিক** API base URL (`EXPO_PUBLIC_API_URL`) এবং Clerk publishable key। এখানে API URL `https://helmetbazar.shop` সেট করা আছে; নতুন সার্ভার হলে সম্পূর্ণ `https://...` origin দিন। Clerk proxy URL একই API থেকে স্বয়ংক্রিয়ভাবে `/api/__clerk` হিসেবে তৈরি হয়। **গোপন key বা password নেই।** ব্যক্তিগত Clerk secret key কখনো APK বা এই ফাইলে দেবেন না।

## প্রয়োজনীয় সফটওয়্যার

1. Android Studio-এর আধুনিক সংস্করণ; SDK Manager-এ Android SDK/Platform **API 36**, Android SDK Build-Tools, NDK ও CMake ইনস্টল করুন। অনুপস্থিত প্যাকেজ Android Studio-কে ইনস্টল করতে দিন এবং SDK license গ্রহণ করুন।
2. **JDK 17** (Android Studio-তে Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK)। Java 19 GraalVM দিয়ে এই প্রজেক্ট বিল্ড করবেন না।
3. **Node.js 20.19 বা নতুন 20 LTS/22 LTS**, সঙ্গে Corepack/pnpm 10.26.1। Android Studio এবং টার্মিনাল—দুটোতেই `node` কমান্ড PATH-এ পাওয়া চাই।
4. প্রথম বিল্ড ও নির্ভরতা ইনস্টলে ইন্টারনেট। Android Studio-কে Gradle SDK, NDK, Maven লাইব্রেরি ডাউনলোড করতে দিতে হবে।
5. Windows-এর MAX_PATH ঝুঁকি কমাতে ZIP-এর ছোট `BK` ফোল্ডারটি যেমন `C:\BK`-তে extract করুন; গভীর nested folder-এ নয়। `.npmrc`-এর hoisted pnpm linker থেকে React Native Gradle plugin-গুলো ইনস্টল-পরবর্তী Node package resolution দিয়ে খুঁজে নেওয়া হয়, archive-এর মেশিন-নির্দিষ্ট symlink দিয়ে নয়।

## Windows-এ APK তৈরি

1. ZIP-এর ছোট `BK` ফোল্ডারটি `C:\BK`-তে **পুরোপুরি Extract** করুন (শুধু `android/` ফোল্ডার আলাদা করবেন না)।
2. `C:\BK`-তে PowerShell খুলে চালান:

   ```powershell
   corepack enable
   corepack pnpm install --frozen-lockfile
   corepack pnpm typecheck
   ```

   PowerShell-এ execution-policy বাধা এলে Command Prompt-এ একই কমান্ড চালান; প্রয়োজন হলে `corepack.cmd pnpm` ব্যবহার করুন।
3. Android Studio → **Open** → `C:\BK\mobile\android` নির্বাচন করুন। Gradle sync সম্পূর্ণ হতে দিন; SDK install/license প্রম্পট গ্রহণ করুন। Node.js PATH-এ না থাকলে Android Studio আবার চালু করুন।
4. Android Studio-র **Terminal**-এ (android ফোল্ডার থেকে):

   `C:\BK` থেকে `corepack pnpm android:release` চালান। এই helper
   `mobile/public-build.json`-এর public API ও Clerk settings Android bundle-এ
   দেয়, তারপর Gradle release build চালায়। APK:
   `C:\BK\mobile\android\app\build\outputs\apk\release\app-release.apk`।

## macOS/Linux

```sh
cd BK
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm android:release
```

APK: `mobile/android/app/build/outputs/apk/release/app-release.apk`।
Release helper reads the public API and Clerk settings from
`mobile/public-build.json` and passes them to the Android bundle build. The
Expo app configuration remains the static `mobile/app.json`.

**গুরুত্বপূর্ণ:** `assembleDebug`-এর APK সাধারণত চালাতে Metro প্রয়োজন হয়। স্বতন্ত্র APK-এর জন্য **assembleRelease**-ই চালাবেন। এই প্রজেক্টে local release APK নিজস্ব কম্পিউটারে তৈরি হওয়া **debug key দিয়ে sign** হয়; ZIP-এ কোনো keystore নেই। Play Store/ব্যবসায়িক প্রকাশ বা ভবিষ্যৎ আপডেটের জন্য Android Studio-র **Build → Generate Signed App Bundle / APK** দিয়ে নিজের গোপন release keystore তৈরি করে নিরাপদে বাইরে রাখুন। অন্য key দিয়ে sign করা APK দিয়ে আগের ইনস্টল আপডেট করা যাবে না।

## সঠিক প্রত্যাশা ও যাচাইয়ের সীমা

- এটি **বর্তমান BanglaKhata Mobile-এর** সুবিধা, পূর্ণ ওয়েবসাইটের সব সুবিধা নয়। বিশেষ করে মোবাইলে নতুন অ্যাকাউন্ট তৈরির পর্দা বা ওয়েবের সব স্টাফ/স্ক্যানার/রিপোর্ট পর্দা নেই। নতুন অ্যাকাউন্ট ওয়েবে খুলে তারপর মোবাইলে সাইন-ইন করুন।
- লেনদেনের এন্ট্রি ইন্টারনেট থাকা অবস্থায় সঙ্গে সঙ্গে সার্ভারে পাঠানো হয়। সার্ভার সফলভাবে গ্রহণ না করলে এন্ট্রি AsyncStorage/SQLite/offline outbox-এ লেখা হয় না; ফর্মটি খোলা থাকা পর্যন্ত তথ্য শুধু UI memory-তে থাকে। retry-তে একই request ID ব্যবহার করে idempotency বজায় থাকে। বিলের নির্বাচিত ছবি আপলোডের জন্য সাময়িকভাবে ফোনে থাকে, তবে এন্ট্রি/খসড়া হিসেবে স্থানীয়ভাবে সংরক্ষিত হয় না।
- আগের Expo mobile সংস্করণে থাকা পাঠানো-না-হওয়া offline খসড়া এই সরাসরি-server build দিয়ে replay হবে না। APK update করার আগে পুরোনো অ্যাপে সেগুলো sync/সমাধান করুন।
- API base URL `https://helmetbazar.shop`; production Clerk proxy একই host-এর `/api/__clerk` রুট ব্যবহার করে। cPanel-এ এই host-এর `/api/*` অবশ্যই চলমান Node.js API app-এ পাঠাতে হবে—`public_html`-এর স্থির ফাইল একা API চালাতে পারে না। অন্য সার্ভারে গেলে `mobile/public-build.json`-এর `EXPO_PUBLIC_API_URL` বদলে সম্পূর্ণ HTTPS origin দিন (শেষে `/api` দেবেন না)। Clerk production tenant-এ নতুন proxy origin অনুমোদন করাও লাগতে পারে। development Clerk-এর ব্যবহারকারী production-এর ব্যবহারকারীর সমান নয়।
- এখানে প্রকল্পের **TypeScript পরীক্ষা, offline-submit না করার তিনটি focused test, clean ZIP extract-এর পর frozen-lockfile install, Android Hermes JS bundle export এবং React Native Gradle plugin resolution** যাচাই করা হয়েছে। APK বানানোর Gradle ধাপ Android SDK অনুপস্থিত থাকায় সম্পূর্ণ compile/sign করা যায়নি; বাস্তব Android ফোনেও পরীক্ষা করা হয়নি। তাই “১০০% error-free” নিশ্চয়তা দেওয়া যায় না। SDK/NDK ইনস্টল থাকা Windows PC-তে `assembleRelease` চালানোই চূড়ান্ত বিল্ড যাচাই।
- কোনো ডাটাবেস, access token, ব্যক্তিগত ছবি/হিসাব, `node_modules`, `local.properties`, পাসওয়ার্ড বা সাইনিং কী ZIP-এ রাখা হয়নি।