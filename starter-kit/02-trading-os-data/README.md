# Trading OS — Data Repository

هذا المستودع يجب أن يكون **Private**.

يحتوي على:

- `data/state.json` — قاعدة البيانات الأساسية.
- `attachments/trades/` — شارتات الصفقات.
- `scripts/build_excel.py` — مولد Excel.
- `.github/workflows/build-excel.yml` — Workflow لتحديث Excel تلقائيًا.
- `exports/Trading_Journal.xlsx` — الناتج الذي ينشأ تلقائيًا بعد أول تشغيل للـWorkflow.

لا تضع GitHub Token داخل هذا المستودع أو أي ملف فيه.
