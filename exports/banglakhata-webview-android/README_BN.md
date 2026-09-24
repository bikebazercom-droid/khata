# বাংলা খাতা Android WebView প্রজেক্ট

এই Android Studio প্রজেক্টটি প্রকাশিত বাংলা খাতা ওয়েবসাইটকে নিরাপদ HTTPS WebView-তে চালায়।
এটি মূল ওয়েবসাইট বা বিদ্যমান Expo মোবাইল অ্যাপের ফাইল পরিবর্তন করে না।

## Android Studio-তে খুলে APK তৈরি

1. ZIP ফাইলটি Extract করুন।
2. Android Studio-তে **File → Open** নির্বাচন করে `BanglaKhataWebView` ফোল্ডারটি খুলুন—যে ফোল্ডারে `settings.gradle.kts` আছে।
3. Gradle Sync শেষ হতে দিন। Android SDK Platform 35 এবং JDK 17 ইনস্টল থাকতে হবে।
4. পরীক্ষার জন্য ফোনে Developer options ও USB debugging চালু করে USB দিয়ে যুক্ত করুন।
5. **Build → Build Bundle(s) / APK(s) → Build APK(s)** নির্বাচন করুন।
6. পরীক্ষার APK তৈরি হবে `app/build/outputs/apk/debug/app-debug.apk`-এ। Android Studio-র **Locate** বোতাম থেকেও ফাইলটি পাওয়া যায়।

কমান্ড লাইনে debug APK তৈরি করতে প্রজেক্ট ফোল্ডারে চালান:

```bash
./gradlew assembleDebug
```

Windows-এ:

```bat
gradlew.bat assembleDebug
```

APK-টি ফোনে কপি করে খুলুন, অথবা Android Studio-তে ফোন নির্বাচন করে **Run** চাপুন।

## ওয়েবসাইটের ঠিকানা বদলানো

ডিফল্ট ঠিকানা `https://hazarikhata.replit.app/`। অন্য HTTPS সাইটে পরীক্ষা করতে:

```bash
./gradlew assembleDebug -PwebAppUrl=https://your-domain.example/
```

শুধু HTTPS ঠিকানা গ্রহণ করা হয়। কোনো API key বা password APK-তে রাখা হয়নি।

## কী কী এতে আছে

- Android Manifest এবং Internet permission
- Android Studio-র Gradle Kotlin DSL project ও Gradle Wrapper
- JavaScript, DOM storage, session cookies-সহ WebView
- ফোনের Back বোতাম, নেটওয়ার্ক না থাকলে retry পর্দা
- ওয়েবসাইটের ফাইল বাছাই ও HTTPS ফাইল ডাউনলোড
- অ্যাপ আইকন এবং বাংলা নাম

## গুরুত্বপূর্ণ সীমা

- এই অ্যাপটি ওয়েবসাইটের Android shell; এটি React ওয়েবসাইটের source বা server-কে APK-র মধ্যে কপি করে না। ওয়েবসাইট ও ইন্টারনেট চালু থাকতে হবে।
- ইমেইল/পাসওয়ার্ড বা OTP sign-in ওয়েবসাইটের নিজস্ব service-এর ওপর নির্ভর করে। Google-এর মতো social login WebView-তে provider-এর সীমাবদ্ধতায় কাজ নাও করতে পারে। বাস্তব ফোনে sign-in পরীক্ষা করুন।
- ছবি/ফাইল আপলোড ডিভাইসের file picker দিয়ে হয়; সরাসরি ক্যামেরা খোলা এই wrapper-এ যোগ করা হয়নি।
- এই workspace-এ Android SDK/JDK ইনস্টল নেই, তাই এখানে APK compile করা সম্ভব হয়নি। Android Studio-তে Gradle Sync ও Build চালিয়ে প্রকৃত ডিভাইসে পরীক্ষা করুন।

APK তৈরি ও বাস্তব ডিভাইসে পরীক্ষা না করে কোনো সফটওয়্যারের “১০০% নির্ভুল” কাজ করার নিশ্চয়তা দেওয়া যায় না।