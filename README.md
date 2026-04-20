# לוח זמנים חכם לבית כנסת

צג דיגיטלי לבית כנסת, סטטי לגמרי, מתארח בחינם ב-GitHub Pages.
דף הניהול כותב לעצמו למאגר דרך GitHub Actions — הסיסמה נשמרת כ-Secret של המאגר ולא חושפת לאף אחד.

## תכונות

- שעון חי + תאריך עברי ולועזי + פרשת השבוע
- זמני היום (עלות, הנץ, סו״ז ק״ש, שקיעה, צאה״כ וכד׳) לפי כתובת/מיקום
- זמני תפילה ליום חול ולשבת, כולל הדלקת נרות ומוצ״ש מחושבים אוטומטית
- תמיכה במספר חדרי תפילה (כל אחד עם זמנים משלו)
- לוח הנצחות — מזהה אוטומטית אם היום חל יארצייט ומדגיש
- לוח הודעות מתגלגל (עם תאריכי תוקף)
- זמנים מיוחדים לתאריכים ספציפיים (חגים, אירועים)
- העלאת CSV ללוחות, או הזנה ידנית
- ממשק ניהול שמבצע commit ישיר למאגר — בלי שרת, בלי מסד נתונים

## ארכיטקטורה

```
[ דפדפן ] ── admin.html ──▶ GitHub API (workflow_dispatch)
                                  │
                                  ▼
                        [ GitHub Actions: admin-save.yml ]
                         בודק HMAC(payload, ADMIN_PASSWORD)
                                  │
                                  ▼
                         commit ל-data/*.json
                                  │
                                  ▼
                        GitHub Pages → [ index.html ]
```

הסיסמה **לעולם לא עוזבת את הדפדפן**. הדפדפן מחשב HMAC-SHA256 על המטען עם הסיסמה כמפתח,
והורקפלו מחשב את אותו HMAC עם ה-Secret במאגר. אם ההאשים זהים — השמירה מאושרת.

---

## הוראות הקמה

### 1. יצירת מאגר משלכם
לחצו על "Use this template" ב-GitHub, או בצעו fork של המאגר.

### 2. הפעלת GitHub Pages
בהגדרות המאגר:
- **Settings → Pages → Build and deployment**
- **Source:** Deploy from a branch
- **Branch:** `main` / `/ (root)`
- שמירה

המערכת תהיה זמינה ב: `https://<username>.github.io/<repo-name>/`

### 3. הגדרת סיסמת הניהול (Secret)
- **Settings → Secrets and variables → Actions → New repository secret**
- **Name:** `ADMIN_PASSWORD`
- **Value:** הסיסמה שתרצו
- שמירה

### 4. יצירת Personal Access Token
לטריגור של ה-Action דרוש טוקן עם הרשאה מצומצמת:

- פתחו https://github.com/settings/personal-access-tokens/new
- **Token name:** smart-zmanim
- **Resource owner:** המשתמש שלכם
- **Repository access:** Only select repositories → בחרו את מאגר הלוח
- **Permissions → Repository permissions:**
  - `Actions`: **Read and write**
  - `Metadata`: Read-only (נדרש אוטומטית)
- Generate token — העתיקו (מוצג פעם אחת בלבד)

> הטוקן נשמר ב-localStorage של הדפדפן שלכם בלבד. הוא מאפשר **רק להפעיל את ה-workflow**, לא לבצע commit ישיר, ולא לגשת למאגרים אחרים.

### 5. כניסה לממשק הניהול
פתחו `https://<username>.github.io/<repo>/admin.html` והזינו:
- **Owner/Repo:** יזוהה אוטומטית
- **Token:** הטוקן מהשלב הקודם
- **Password:** הסיסמה שהגדרתם ב-Secret

**Tip:** הטוקן נשמר אוטומטית בדפדפן; הסיסמה צריכה להיות מוקלדת בכל כניסה.

---

## מבנה הנתונים

כל הנתונים שמורים כקבצי JSON בתיקייה `data/`:

| קובץ | תוכן |
|------|------|
| `config.json` | שם בית הכנסת, מיקום, אילו זמנים להציג |
| `rooms.json`  | רשימת חדרי תפילה וזמניהם |
| `memorial.json` | רשימת הנצחות (שם + תאריך עברי) |
| `announcements.json` | הודעות עם תאריכי תוקף |
| `special-times.json` | דריסות זמני תפילה לתאריכים ספציפיים |

ניתן גם לערוך את הקבצים ידנית ב-GitHub ולבצע commit — זה יעבוד בדיוק אותו דבר.

### פורמט CSV להנצחות
עמודות נתמכות (עברית או אנגלית, בכל סדר):
```
שם,יום,חודש,הערות
יוסף בן אברהם,כ״ג,ניסן,אבי
```

### פורמט CSV לזמנים מיוחדים
```
תאריך,חדר,תפילה,שעה
2026-05-14,main,מנחה,18:30
```
שדה `חדר` אופציונלי — ריק = חל על כל החדרים. הערך צריך להיות `id` של חדר קיים.

---

## הצגת הלוח

פתיחה רגילה: `https://<username>.github.io/<repo>/`

בחירת חדר ספציפי: `?room=<room-id>` (למשל `?room=beit-midrash`)

להצגה ככיוסק (מסך מלא, ללא סרגלים) — פתחו את הדפדפן במצב fullscreen (`F11`).

---

## שאלות נפוצות

**האם צריך שרת?** לא. הכל סטטי + GitHub Actions.

**כמה עולה?** 0. GitHub Pages ו-Actions חינמיים למאגרים ציבוריים.

**המאגר חייב להיות ציבורי?** כדי שה-Pages יהיה חינם — כן. כל התוכן (זמני תפילה, שמות להנצחה, הודעות) ממילא מופיע באתר הפומבי, אז אין שם סוד.

**מה אם מישהו ימצא את ה-Token שלי?** הוא יוכל רק להפעיל את ה-Action הספציפי — בלי הסיסמה (שב-Secret), לא ניתן לכתוב כלום. בנוסף, ניתן לבטל את הטוקן ב-GitHub בכל רגע.

**יש מחשבון זמנים מקומי?** כן — ספריית `@hebcal/core`, רצה בתוך הדפדפן.

---

## פיתוח מקומי

```bash
git clone https://github.com/<user>/smart-zmanim.git
cd smart-zmanim
python3 -m http.server 8000
# פתחו http://localhost:8000
```

ממשק הניהול פועל רק כשהאתר רץ מדומיין שמזהה owner/repo תקפים ב-GitHub.

---

## רישיון
MIT
