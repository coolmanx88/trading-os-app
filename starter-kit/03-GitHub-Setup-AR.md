# دليل إعداد Trading OS لأخ جديد

> هذه الحزمة مصممة لإنشاء نسخة مستقلة تمامًا من Trading OS على حساب GitHub جديد. لا تحتوي على صفقات أو حسابات أو صور تداول خاصة بالمستخدم الأصلي.

## 1) المستودعات المطلوبة

أنشئ مستودعين فقط على حساب GitHub الخاص بك:

| الاسم | النوع | الغرض |
|---|---|---|
| `trading-os-app` | **Public** | ملفات التطبيق وGitHub Pages |
| `trading-os-data` | **Private** | البيانات الحقيقية، الصفقات، الحسابات، الشارتات، والمخرجات |

يجب أن يكون الفرع الافتراضي في الاثنين: `main`.

### رفع الملفات

- ارفع **محتويات** المجلد `01-trading-os-app` إلى جذر مستودع `trading-os-app`.
- ارفع **محتويات** المجلد `02-trading-os-data` إلى جذر مستودع `trading-os-data`.
- لا ترفع مجلد `Trading-OS-Starter` نفسه داخل المستودع؛ ارفع الملفات الداخلية في أماكنها الصحيحة.

---

# 2) إنشاء Fine-grained Personal Access Token

الـToken يستخدمه المتصفح للوصول إلى المستودع الخاص `trading-os-data`. لا ترسله إلى أي شخص ولا تضعه داخل GitHub أو داخل ChatGPT.

## الخطوات

1. افتح GitHub وسجّل الدخول بحسابك.
2. اضغط صورة الحساب أعلى اليمين.
3. اختر **Settings**.
4. من القائمة اليسرى انزل إلى **Developer settings**.
5. اختر **Personal access tokens**.
6. اختر **Fine-grained tokens**.
7. اضغط **Generate new token**.
8. في **Token name** اكتب مثلًا: `Trading OS Browser Sync`.
9. في **Expiration** اختر مدة مناسبة. يفضّل سنة إذا كان الحساب شخصيًا، ثم يتم تجديده عند انتهاء المدة.
10. في **Resource owner** اختر حساب GitHub الخاص بك.
11. في **Repository access** اختر **Only select repositories**.
12. من **Selected repositories** اختر فقط: `trading-os-data`.
13. انتقل إلى **Repository permissions**.
14. عند **Contents** اختر **Read and write**.
15. اترك بقية الصلاحيات على الوضع الافتراضي ما لم يطلب GitHub صلاحية إضافية تلقائيًا. `Metadata` تكون عادة Read-only تلقائيًا.
16. اضغط **Generate token**.
17. انسخ الـToken فورًا واحفظه في مكان آمن. لا يمكن الاعتماد على رؤيته مرة أخرى بنفس الطريقة.

### الإعداد الصحيح باختصار

```text
Resource owner: YOUR_GITHUB_USERNAME
Repository access: Only select repositories
Selected repository: trading-os-data
Repository permissions:
  Contents: Read and write
```

لا يحتاج Token إلى صلاحية كتابة على `trading-os-app` لأن التطبيق يقرأ ملفاته علنًا من GitHub Pages، بينما البيانات تكتب في المستودع الخاص فقط.

---

# 3) تفعيل GitHub Pages

بعد رفع محتويات `01-trading-os-app` إلى مستودع `trading-os-app`:

1. افتح مستودع `trading-os-app`.
2. اختر **Settings**.
3. من القائمة الجانبية اختر **Pages** ضمن قسم Code and automation.
4. في **Build and deployment** ابحث عن **Source**.
5. اختر **GitHub Actions**.
6. ارجع إلى تبويب **Actions** في المستودع.
7. يجب أن يظهر Workflow باسم **Deploy GitHub Pages**.
8. انتظر حتى يصبح التشغيل باللون الأخضر ويظهر `success`.
9. ارجع إلى **Settings > Pages** وستجد رابط الموقع المنشور.

الرابط يكون غالبًا:

```text
https://YOUR_GITHUB_USERNAME.github.io/trading-os-app/
```

ملف النشر موجود داخل الحزمة في:

```text
.github/workflows/pages.yml
```

---

# 4) ربط التطبيق بالمستودع الخاص

بعد فتح رابط GitHub Pages:

1. افتح **Settings** داخل Trading OS.
2. أدخل بيانات GitHub التالية:

```text
Owner: YOUR_GITHUB_USERNAME
Repository: trading-os-data
Branch: main
Path: data/state.json
Token: الـ Fine-grained PAT الذي أنشأته
```

3. نفّذ **Test Connection** إن كان الزر موجودًا.
4. ثم اضغط **Sync**.
5. يجب أن تظهر رسالة نجاح المزامنة.

> مهم: لا تكتب الـToken في ملفات الكود ولا في README ولا في المحادثة مع ChatGPT. يجب إدخاله فقط محليًا داخل إعدادات التطبيق في متصفحك.

---

# 5) فحص أول تشغيل

بعد نجاح الربط:

1. أنشئ حساب تداول تجريبي داخل Trading OS.
2. ابدأ صفقة اختبارية وأرفق Entry Chart.
3. أغلق الصفقة وأرفق Exit Chart.
4. افتح تفاصيل الصفقة المغلقة وتأكد من ظهور الشارتين.
5. عبّئ Post-Trade Review واحفظها/اعتمدها.
6. اضغط Sync.
7. افتح مستودع `trading-os-data` وتأكد أن `data/state.json` تم تحديثه.
8. تأكد أن الصور ظهرت تحت `attachments/trades/<TRADE_ID>/`.
9. انتظر GitHub Action الخاص بالـExcel، ثم تحقق من `exports/Trading_Journal.xlsx`.

إذا نجحت هذه الخطوات، فالنسخة أصبحت مستقلة وجاهزة للاستخدام.