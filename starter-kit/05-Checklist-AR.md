# Checklist — Trading OS Starter

## قبل رفع الملفات
- [ ] لدي حساب GitHub مستقل.
- [ ] أنشأت `trading-os-app` كـ Public.
- [ ] أنشأت `trading-os-data` كـ Private.
- [ ] الفرع الافتراضي في الاثنين هو `main`.

## رفع الملفات
- [ ] رفعت محتويات `01-trading-os-app` إلى جذر `trading-os-app`.
- [ ] رفعت محتويات `02-trading-os-data` إلى جذر `trading-os-data`.
- [ ] الملف `data/state.json` موجود في المستودع الخاص.
- [ ] الملف `.github/workflows/build-excel.yml` موجود في المستودع الخاص.
- [ ] الملف `scripts/build_excel.py` موجود في المستودع الخاص.

## Token
- [ ] أنشأت Fine-grained PAT.
- [ ] Resource owner = حسابي.
- [ ] Repository access = Only select repositories.
- [ ] Selected repository = `trading-os-data` فقط.
- [ ] Contents = Read and write.
- [ ] لم أضع الـToken في أي Repository أو محادثة.

## Pages
- [ ] Settings > Pages > Source = GitHub Actions.
- [ ] Workflow `Deploy GitHub Pages` نجح.
- [ ] رابط الموقع يفتح بدون أخطاء.

## الربط
- [ ] Owner = اسم حسابي في GitHub.
- [ ] Repository = `trading-os-data`.
- [ ] Branch = `main`.
- [ ] Path = `data/state.json`.
- [ ] أدخلت الـToken محليًا داخل التطبيق.
- [ ] Sync نجح.

## اختبار End-to-End
- [ ] أنشأت Account تجريبي.
- [ ] أنشأت Trade تجريبي.
- [ ] Entry Chart تم حفظه.
- [ ] Exit Chart تم حفظه.
- [ ] Closed Trade Detail تعرض المعلومات والشارتات.
- [ ] Post-Trade Review تعمل.
- [ ] Sync حدّث `data/state.json`.
- [ ] الصور ظهرت في `attachments/trades/<TRADE_ID>/`.
- [ ] GitHub Action للـExcel نجح.
- [ ] `exports/Trading_Journal.xlsx` تم إنشاؤه.

إذا اكتملت جميع البنود فالنظام جاهز للاستخدام الحقيقي.