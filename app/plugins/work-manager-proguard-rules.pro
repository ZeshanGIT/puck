# WorkManager + Room: R8 removes reflective no-arg constructors (Expo SDK 58 + Notifee work-runtime).
# See https://github.com/expo/expo/issues/52173
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class * extends androidx.work.InputMerger { <init>(); }
