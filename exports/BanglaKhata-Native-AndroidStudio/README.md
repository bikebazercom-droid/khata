# বাংলাখাতা — নেটিভ Android Studio প্রজেক্ট

এটি **React Native/Expo-এর জেনারেট করা নেটিভ Android Gradle প্রজেক্ট**, WebView নয়। **Expo Go লাগবে না।** `mobile/android/` ফোল্ডার Android Studio-তে খুলে APK তৈরি করা যায়। অ্যাপের JavaScript ও ছবি *release APK-এর ভেতরেই* প্যাক হয়; ফোনে চালানোর জন্য Metro সার্ভার লাগে না। ফোনে ইন্টারনেট থাকলে অ্যাপ প্রকাশিত বাংলাখাতা সার্ভারে সংযুক্ত হয়; সার্ভার/ডাটাবেস APK-এর মধ্যে নেই।

## এই ZIP-এ কী আছে

- `mobile/android/` — আসল Kotlin/Java Android সোর্স, Gradle wrapper/JAR, অ্যাপ আইকন ও অ্যান্ড্রয়েড রিসোর্স।
- `mobile/app/`, `mobile/lib/`, `mobile/assets/` — বিদ্যমান BanglaKhata Mobile-এর নেটিভ React Native পর্দা, ক্যামেরা থেকে বিল ছবি, খাতা ও লেনদেন, রিপোর্ট/PDF, অফলাইন খসড়া ও সিঙ্ক, ফোন/Clerk সাইন-ইন।
- `lib/api-client-react/` — অ্যাপের প্রয়োজনীয় স্বয়ংসম্পূর্ণ শেয়ার্ড API ক্লায়েন্ট।
- `pnpm-lock.yaml`, `pnpm-workspace.yaml` — বাইরের মূল প্রজেক্ট ছাড়াই নির্ভরতা ইনস্টলের জন্য।
- `mobile/public-build.json` — প্রকাশিত ওয়েবসাইটে ইতোমধ্যেই প্রকাশিত **পাবলিক** সার্ভার ডোমেইন ও Clerk publishable key/proxy। **গোপন key বা password নেই।** লাইভ সাইট/Clerk বদলালে ফাইলটির এই তিনটি মান পরিবর্তন করে APK আবার বিল্ড করুন। ব্যক্তিগত Clerk secret key কখনো APK বা এই ফাইলে দেবেন না।

## প্রয়োজনীয় সফটওয়্যার

1. Android Studio-এর আধুনিক সংস্করণ; SDK Manager-এ Android SDK/Platform **API 36**, Android SDK Build-Tools, NDK ও CMake ইনস্টল করুন। অনুপস্থিত প্যাকেজ Android Studio-কে ইনস্টল করতে দিন এবং SDK license গ্রহণ করুন।
2. **JDK 17** (Android Studio-তে Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK)। Java 19 GraalVM দিয়ে এই প্রজেক্ট বিল্ড করবেন না।
3. **Node.js 20.19 বা নতুন 20 LTS/22 LTS**, সঙ্গে Corepack/pnpm 10.26.1। Android Studio এবং টার্মিনাল—দুটোতেই `node` কমান্ড PATH-এ পাওয়া চাই।
4. প্রথম বিল্ড ও নির্ভরতা ইনস্টলে ইন্টারনেট। Android Studio-কে Gradle SDK, NDK, Maven লাইব্রেরি ডাউনলোড করতে দিতে হবে।

## Windows-এ APK তৈরি

1. ZIP একটি সাধারণ ফোল্ডারে **পুরোপুরি Extract** করুন (শুধু `android/` ফোল্ডার আলাদা করবেন না)।
2. ZIP-এর মূল ফোল্ডারে PowerShell খুলে চালান:

   ```powershell
   corepack enable
   corepack pnpm install --frozen-lockfile
   corepack pnpm typecheck
   ```

   PowerShell-এ execution-policy বাধা এলে Command Prompt-এ একই কমান্ড চালান; প্রয়োজন হলে `corepack.cmd pnpm` ব্যবহার করুন।
3. Android Studio → **Open** → extracted `BanglaKhata-Native-AndroidStudio/mobile/android` নির্বাচন করুন। Gradle sync সম্পূর্ণ হতে দিন; SDK install/license প্রম্পট গ্রহণ করুন। Node.js PATH-এ না থাকলে Android Studio আবার চালু করুন।
4. Android Studio-র **Terminal**-এ (android ফোল্ডার থেকে):

   ```bat
   gradlew.bat :app:assembleRelease
   ```

   অথবা ZIP-এর মূল ফোল্ডার থেকে `corepack pnpm android:release` চালাতে পারেন। শেষ হলে ইনস্টলযোগ্য APK: `mobile\android\app\build\outputs\apk\release\app-release.apk`।

## macOS/Linux

```sh
cd BanglaKhata-Native-AndroidStudio
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
cd mobile/android
./gradlew :app:assembleRelease
```

APK: `mobile/android/app/build/outputs/apk/release/app-release.apk`।

**গুরুত্বপূর্ণ:** `assembleDebug`-এর APK সাধারণত চালাতে Metro প্রয়োজন হয়। স্বতন্ত্র APK-এর জন্য **assembleRelease**-ই চালাবেন। এই প্রজেক্টে local release APK নিজস্ব কম্পিউটারে তৈরি হওয়া **debug key দিয়ে sign** হয়; ZIP-এ কোনো keystore নেই। Play Store/ব্যবসায়িক প্রকাশ বা ভবিষ্যৎ আপডেটের জন্য Android Studio-র **Build → Generate Signed App Bundle / APK** দিয়ে নিজের গোপন release keystore তৈরি করে নিরাপদে বাইরে রাখুন। অন্য key দিয়ে sign করা APK দিয়ে আগের ইনস্টল আপডেট করা যাবে না।

## সঠিক প্রত্যাশা ও যাচাইয়ের সীমা

- এটি **বর্তমান BanglaKhata Mobile-এর** সুবিধা, পূর্ণ ওয়েবসাইটের সব সুবিধা নয়। বিশেষ করে মোবাইলে নতুন অ্যাকাউন্ট তৈরির পর্দা বা ওয়েবের সব স্টাফ/স্ক্যানার/রিপোর্ট পর্দা নেই। নতুন অ্যাকাউন্ট ওয়েবে খুলে তারপর মোবাইলে সাইন-ইন করুন।
- প্রকাশিত সার্ভার `https://hazarikhata.replit.app`-এর API, এবং production Clerk proxy `/api/__clerk` ব্যবহার হয়। এই পাবলিক কনফিগ 2026-09-27 তারিখে লাইভ সাইট থেকে যাচাই করা; প্রকাশনার ডোমেইন/কী বদলালে `mobile/public-build.json`-এ একসঙ্গে আপডেট করতে হবে। development Clerk-এর ব্যবহারকারী production-এর ব্যবহারকারীর সমান নয়।
- এখানে প্রকল্পের **TypeScript পরীক্ষা, নেটিভ প্রজেক্ট prebuild এবং Android-এর জন্য Hermes JS bundle export** যাচাই করা হয়েছে। SDK না থাকায় এখানকার পরিবেশে Gradle দিয়ে APK সম্পূর্ণ compile/sign বা বাস্তব Android ফোনে চালিয়ে পরীক্ষা করা যায়নি; তাই কোনো নিরঙ্কুশ “১০০% error-free” দাবি নেই। আপনার Android Studio-তে `assembleRelease` সম্পন্ন করাই চূড়ান্ত বিল্ড যাচাই।
- কোনো ডাটাবেস, access token, ব্যক্তিগত ছবি/হিসাব, `node_modules`, `local.properties`, পাসওয়ার্ড বা সাইনিং কী ZIP-এ রাখা হয়নি।