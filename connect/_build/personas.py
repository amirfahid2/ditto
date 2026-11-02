# The audiences the connect pages are built for. Each one fills the same template
# (template.html) with its own words and its own demo board. Run build.py after editing.
#
# A board is a list of squares. A square is {"name", "text"}; a folder is
# {"name", "folder": True, "items": [squares]}. Nine cells fill the demo's 3×3 grid.
# [TODAY], [TOMORROW] and [TIME] in a text become the real date or time, as in the app.
#
# A persona in another language sets "lang" (a key of STRINGS below) and writes its own words
# in that language; "alternates" names the same page in other languages ({lang: path}).

# The words every page shares, by language. English is the base; another language lists what
# it changes. "rtl" turns the page right-to-left; "kb_rows" are the letters of that language's
# own keyboard, the one behind the globe; "locale" shapes dates, times and counts.
STRINGS = {
    "en": {
        "locale": "en-US",
        "home": "Ditto home", "nav_site": "Site", "nav_footer": "Footer",
        "about": "About", "privacy": "Privacy", "web_app": "Web app",
        "h1": "Get Ditto.",
        "appstore_small": "Download on the", "play_small": "Get it on",
        "try_web": "Try it in your browser",
        "fine": "<b>No account. No tracking.</b> Your squares stay on your phone.",
        "guide_label": "Ditto in a minute",
        "clock": "9:41",
        # the guide's conversation; the fourth bubble is the persona's own like_what
        "g1": "So what is Ditto?",
        "g2": "A board of big squares. Each one holds a piece of text you type again and again.",
        "g3": "Like what?",
        "g5": "And then?",
        "g6": "Tap a square and it's copied, ready to paste.",
        "g7": "Or open the Ditto keyboard inside any app and tap: the text is typed straight in.",
        "g8": "Can it see what I write?",
        "g9": "No. There's no account and no tracking. Your squares live on your phone.",
        "g10": "Where do I get it?",
        "g11": "Right here.",
        "guide_fine": 'Want the long version? <a href="../about/">See everything Ditto does</a>.',
        "demo_label": "Try Ditto", "demo_view": "Demo view",
        "board_tab": "The board", "kb_tab": "The keyboard",
        "b_hint": "Tap a square to copy its text.",
        "send": "Send",
        "globe_to_regular": "Switch to the regular keyboard", "globe_to_ditto": "Switch to the Ditto keyboard",
        "hint_board": "Try it: tap a square, or a few in a row.",
        "hint_kb": "Try it: tap a square to put its text in, then send. The globe switches keyboards.",
        "hint_qwerty": "Your usual keyboard. Tap the globe to get Ditto back.",
        "texts": "{n} texts", "copied_many": "Copied {n} squares together", "copied_one": "Copied “{name}”",
        "add_square": "Add square",
        "kb_rows": ["qwertyuiop", "asdfghjkl", "zxcvbnm"], "numbers": "123", "space": "space", "return": "return",
        "privacy_policy": "Privacy Policy", "support": "Support",
        "cue": "Scroll down to the phones",
    },
    # Persian. A "~" in these strings is a zero-width non-joiner (the half-space of می~شود), put in below.
    "fa": {
        "rtl": True,
        "locale": "fa-IR",
        "home": "خانه~ی Ditto", "nav_site": "سایت", "nav_footer": "پاورقی",
        "about": "درباره", "privacy": "حریم خصوصی", "web_app": "نسخه~ی وب",
        "h1": "Ditto را دریافت کنید.",
        "appstore_small": "دانلود از", "play_small": "دریافت از",
        "try_web": "در مرورگر امتحان کنید",
        "fine": "<b>بدون حساب کاربری. بدون ردیابی.</b> مربع~های شما روی گوشی خودتان می~مانند.",
        "guide_label": "Ditto در یک دقیقه",
        "clock": "۹:۴۱",
        "g1": "خب، Ditto چیست؟",
        "g2": "تابلویی از مربع~های بزرگ. هر کدام متنی را نگه می~دارد که بارها و بارها تایپ می~کنید.",
        "g3": "مثلاً چه متنی؟",
        "g5": "و بعد؟",
        "g6": "یک مربع را لمس کنید؛ متن کپی می~شود و آماده~ی جای~گذاری است.",
        "g7": "یا صفحه~کلید Ditto را داخل هر برنامه~ای باز کنید و لمس کنید: متن مستقیم تایپ می~شود.",
        "g8": "می~تواند ببیند چه می~نویسم؟",
        "g9": "نه. نه حساب کاربری دارد و نه ردیابی. مربع~های شما روی گوشی خودتان می~مانند.",
        "g10": "از کجا بگیرمش؟",
        "g11": "همین~جا.",
        "guide_fine": 'نسخه~ی کامل را می~خواهید؟ <a href="../about/">همه~ی کارهای Ditto را ببینید</a>.',
        "demo_label": "Ditto را امتحان کنید", "demo_view": "نمای نمایشی",
        "board_tab": "تابلو", "kb_tab": "صفحه~کلید",
        "b_hint": "یک مربع را لمس کنید تا متنش کپی شود.",
        "send": "ارسال",
        "globe_to_regular": "رفتن به صفحه~کلید معمولی", "globe_to_ditto": "رفتن به صفحه~کلید Ditto",
        "hint_board": "امتحان کنید: یک مربع را لمس کنید، یا چند تا را پشت سر هم.",
        "hint_kb": "امتحان کنید: یک مربع را لمس کنید تا متنش وارد شود، بعد بفرستید. کره~ی زمین صفحه~کلید را عوض می~کند.",
        "hint_qwerty": "صفحه~کلید همیشگی شما. برای برگشتن به Ditto کره~ی زمین را لمس کنید.",
        "texts": "{n} متن", "copied_many": "{n} مربع با هم کپی شد", "copied_one": "«{name}» کپی شد",
        "add_square": "افزودن مربع",
        "kb_rows": ["ضصثقفغعهخحجچ", "شسیبلاتنمکگ", "ظطزرذدپو"], "numbers": "۱۲۳", "space": "فاصله", "return": "بازگشت",
        "privacy_policy": "سیاست حریم خصوصی", "support": "پشتیبانی",
        "cue": "برای دیدن گوشی~ها پایین بروید",
    },
}

def _half_spaces(value):
    """'~' -> zero-width non-joiner, through strings, lists and dicts."""
    if isinstance(value, str):
        return value.replace("~", "\u200c")
    if isinstance(value, list):
        return [_half_spaces(v) for v in value]
    if isinstance(value, dict):
        return {k: _half_spaces(v) for k, v in value.items()}
    return value

STRINGS["fa"] = _half_spaces(STRINGS["fa"])

GENERIC = {
    "path": "connect",
    "title": "Get Ditto — Tap a square, paste anywhere",
    "description": "Download Ditto for iPhone or Android: a board of big, tappable squares for the text you use again and again, and a keyboard that types them into any app. No account, no tracking.",
    "og_description": "Big, tappable squares for the text you use again and again. On the App Store and Google Play.",
    "eyebrow": "Ditto for iPhone and Android",
    "lede": "Ditto is a board of big, tappable squares. Each square holds a piece of text you use again and again — an order set, a template, an address, a reply you type ten times a day. Tap it and the text is ready to paste, or type it straight into any app with the Ditto keyboard.",
    "like_what": "Your address. Directions. A signature. The reply you send ten times a day.",
    "avatar": "KB", "contact": "Kim", "opener": "Hi! What's the address again?",
    "board": [
        {"name": "Address", "text": "742 Evergreen Terrace\nSpringfield, IL 62704"},
        {"name": "Clinic", "folder": True, "items": [
            {"name": "Hours", "text": "We're open Monday to Friday, 8 am – 5 pm."},
            {"name": "Refill", "text": "Your refill request is in. Please allow 2 business days."},
            {"name": "Bring", "text": "Please bring a photo ID and your insurance card to your visit."},
            {"name": "Fax", "text": "Fax: (555) 010-0199"},
        ]},
        {"name": "Running late", "text": "Running about 10 minutes late, sorry! Be there soon."},
        {"name": "Signature", "text": "Best,\nSam"},
        {"name": "Wi-Fi", "text": "Network: Guest\nPassword: sunflower-42"},
        {"name": "Directions", "text": "Park in the back lot and use the side door. Suite 210 is on the second floor."},
        {"name": "Thank you", "text": "Thank you so much, I really appreciate it!"},
        {"name": "Review", "text": "If you have a minute, a quick review would mean a lot. Thank you!"},
        {"name": "Out of office", "text": "I'm out of the office until [TOMORROW] and will reply when I'm back."},
    ],
}

EDUCATORS = {
    "path": "connect1",
    "title": "Get Ditto — Tap a square, paste anywhere",
    "description": "Download Ditto for iPhone or Android: a board of big, tappable squares for the notes you send again and again — parent reminders, grading comments, office hours — and a keyboard that types them into any app. No account, no tracking.",
    "og_description": "Parent reminders, grading comments and office hours, one tap away. On the App Store and Google Play.",
    "eyebrow": "Ditto for iPhone and Android",
    "lede": "Ditto is a board of big, tappable squares. Each square holds a piece of text you use again and again — a parent reminder, a grading comment, your office hours, the late-work policy you explain every week. Tap it and the text is ready to paste, or type it straight into any app with the Ditto keyboard.",
    "like_what": "Your office hours. A permission-slip reminder. A grading comment. The late-work policy you explain every week.",
    "avatar": "JP", "contact": "Jordan (parent)", "opener": "Hi! Is the permission slip due Friday?",
    "board": [
        {"name": "Office hours", "text": "I'm available during office hours this week. Stop by, or email me to set up another time."},
        {"name": "Parents", "folder": True, "items": [
            {"name": "Permission slip", "text": "Reminder: the field trip permission slip is due soon. Please sign it and send it back with your child."},
            {"name": "Great day", "text": "Quick note: your child had a great day today — thought you'd like to know!"},
            {"name": "Missing work", "text": "Your child has a few missing assignments. They can still turn them in for credit. Let me know if you have questions."},
            {"name": "Conference", "text": "I'd love to meet about your child's progress. Would a short call work for you? Reply with a time that suits you."},
        ]},
        {"name": "Grading", "folder": True, "items": [
            {"name": "Show your work", "text": "Good thinking here. Show each step so I can give full credit."},
            {"name": "Cite sources", "text": "Strong argument. Add a citation for each claim so readers can check it."},
            {"name": "Revise", "text": "You're close. Revise the parts I marked and resubmit."},
            {"name": "Great work", "text": "Excellent work: clear, thorough and well organized."},
        ]},
        {"name": "Late work", "text": "Late work is accepted for partial credit for a short time after the due date. After that, please come see me."},
        {"name": "Hall pass", "text": "Please excuse this student from class at [TIME] to visit the office."},
        {"name": "Rec letter", "text": "Happy to write you a recommendation. Please send your résumé, the program name and the deadline well ahead of time."},
        {"name": "Out today", "text": "I'm out of the building today and will reply [TOMORROW]."},
        {"name": "Thank you", "text": "Thank you so much for your support — it makes a real difference for our students."},
        {"name": "Signature", "text": "Ms. Rivera\nGrade 7 Science, Room 214"},
    ],
}

PHYSICIANS = {
    "path": "connect2",
    "title": "Get Ditto — Tap a square, paste anywhere",
    "description": "Download Ditto for iPhone or Android: a board of big, tappable squares for the orders you write again and again — fluids, labs, an antibiotic start, potassium — and a keyboard that types them into any app. No account, no tracking.",
    "og_description": "Fluids, labs, antibiotics and potassium, one tap away. On the App Store and Google Play.",
    "eyebrow": "Ditto for iPhone and Android",
    "lede": "Ditto is a board of big, tappable squares. Each square holds a piece of text you use again and again — a fluid bolus, a lab order, an antibiotic start, the potassium replacement you write every day. Tap it and the text is ready to paste, or type it straight into any app with the Ditto keyboard.",
    "like_what": "A saline bolus. Stat labs. A pneumonia order set. The potassium you replace every day.",
    "avatar": "TR", "contact": "Taylor (RN)", "opener": "Hi Dr. Chen, bed 12 is nauseated. Orders?",
    "alternates": {"fa": "connect4"},
    # The board below is a real hospitalist's, shared by its owner on 2026-11-01 (Downloads/Ditto board.json).
    "board": [
        {"name": "IVF", "folder": True, "items": [
            {"name": "IVFx20h", "text": "Start normal saline at 50 cc an hour x 20 hours.   Check cbc cmp tomorrow."},
            {"name": "Bolus500", "text": "Bolus 500 ml of normal saline now stat"},
            {"name": "Bolus1L", "text": "Bolus 1,000 mL (1 liter) normal saline stat now"},
            {"name": "While NPO", "text": "Normal saline at 50 cc an hour while NPO"},
        ]},
        {"name": "LABS", "folder": True, "items": [
            {"name": "BASIC LABS ROUTINE", "text": "Check cbc cmp routine"},
            {"name": "STAT", "text": "Stat CBC and CMP"},
        ]},
        {"name": "PNA", "folder": True, "items": [
            {"name": "Suspect PNA", "text": "Check CXR now, CBC, CMP routine and if not already ordered, add incentive spirometer and train how to use"},
            {"name": "CAP IV", "text": "Start on 2 grams IV Rocephin daily x 7 days.   Also start on PO doxycycline 100 mg bid x 7 days.  Start IV antibiotics STAT.  \n\nCheck procalcitonin, urine strep antigen, and urine Legionella antigen routine ( non stat order )"},
            {"name": "HCAP", "text": "Start on 2 grams IV cefepime q8 hours x 7 days.   Also start on PO doxycycline 100 mg bid x 7 days.  Start IV antibiotics STAT.  \n\nCheck procalcitonin, urine strep antigen, and urine Legionella antigen routine ( non stat order )"},
        ]},
        {"name": "Nausea", "folder": True, "items": [
            {"name": "Zofran PRN", "text": "Zofran 4 mg PO prn q6 hours"},
            {"name": "Zofran ATC", "text": "Zofran 4 mg PO q6 hours routine for 2 days, then make it PRN"},
        ]},
        {"name": "SWELLING", "folder": True, "items": [
            {"name": "LLE", "text": "Check venous duplex lle"},
            {"name": "RLE", "text": "Check venous duplex rle"},
            {"name": "Wrap Legs", "text": "Leg Wrapping and Elevation Instructions: \n\n1. Wrap both legs with an ACE Bandage:\n\n-Start at the toes and wrap snugly to ensure all toes are completely covered.\n-Gradually decrease the tightness as you move upward, making the wrap loosest just below the knees. \n-Proper tightness at the toes/feet is critical to prevent swelling from worsening. \n\n2. Elevate the Legs with Pillows: \n\n-Use two pillows to elevate the legs. \n-Make sure the feet are resting on the pillows so that the feet are positioned as the highest point of the lower extremities.  \n\n***Double-check that the toes are fully wrapped and the tightness decreases as it goes up the leg. \n\n***Confirm that the feet are elevated higher than the rest of the legs to promote proper drainage and reduce swelling."},
            {"name": "Wrap feet", "text": "At night while sleeping:  \n\nPlease wrap both of the patient's feet ONLY.  Gradual decrease in compression, ACE wrapping should be tightest at the toes and the compression should be the LEAST at the ankle joint.  Do NOT wrap the ankle or patients feet.  REMOVE ALL WRAPPING DURING THE DAY.  \n\nThis is to be done for 3 evenings.  \n\nElevate the patient's feet on 2 pillows at night."},
        ]},
        {"name": "K", "folder": True, "items": [
            {"name": "One time", "text": "Potassium 40 meq once PO (ask patient if they prefer the large pill or the liquid form ; if they have dysphagia, give them the liquid potassium.)"},
            {"name": "2x", "text": "Potassium 40 meq once now, then again in 4 hours, then STOP, repeat BMP tomorrow.\n\n(ask patient if they prefer the large pill or the liquid form ; if they have dysphagia, give them the liquid potassium.)"},
            {"name": "3x", "text": "Potassium 40 meq once now, then again in 4 hours, then again in 4 hours then STOP, repeat BMP tomorrow.\n\n(ask patient if they prefer the large pill or the liquid form ; if they have dysphagia, give them the liquid potassium.)"},
            {"name": "Daily", "text": "Potassium 40 meq daily.  \n\n(ask patient if they prefer the large pill or the liquid form ; if they have dysphagia, give them the liquid potassium.)"},
        ]},
        {"name": "OH", "folder": True, "items": [
            {"name": "Mid 2.5", "text": "Midodrine 2.5 mg TID, time for 7 am, 11 am and 4 pm.  Hold if prior to giving systolic blood pressure is above 140."},
            {"name": "Mid 5", "text": "Midodrine 5 mg TID, time for 7 am, 11 am and 4 pm.  Hold if prior to giving systolic blood pressure is above 140."},
            {"name": "Droxidopa", "text": "Droxidopa 100 mg twice a day.  Time for 7 am and 12 pm. Hold if prior to giving systolic blood pressure is above 140.   Sleep with head of bed elevated."},
            {"name": "Florinef", "text": "Florinef 0.1 mg daily PO.  Give at 8 am daily.   Hold if systolic blood pressure above 140. \n\nCheck BMP tomorrow, then weekly to monitor potassium level."},
        ]},
        {"name": "Constipation", "folder": True, "items": [
            {"name": "MiraLax", "text": "Please add MiraLax 17 grams PO daily"},
            {"name": "Bowel Protocol", "text": "Please place on bowel protocol"},
            {"name": "Enema x1", "text": "Please give a soap suds enema now; if we do not have soap suds, give a fleet enema now once."},
        ]},
        {"name": "INCENTIVE SPIROMETER", "text": "Please order an incentive spirometer.  Instruct patient how to use it."},
    ],
}

EXECUTIVES = {
    "path": "connect3",
    "title": "Get Ditto — Tap a square, paste anywhere",
    "description": "Download Ditto for iPhone or Android: a board of big, tappable squares for the replies you send again and again — approvals, reschedules, thank-yous — and a keyboard that types them into any app. No account, no tracking.",
    "og_description": "Approvals, reschedules and thank-yous, one tap away. On the App Store and Google Play.",
    "eyebrow": "Ditto for iPhone and Android",
    "lede": "Ditto is a board of big, tappable squares. Each square holds a piece of text you use again and again — a reschedule, a quick approval, a thank-you, the “let's find 15 minutes” you send ten times a day. Tap it and the text is ready to paste, or type it straight into any app with the Ditto keyboard.",
    "like_what": "Running late. Approved. Let's find 15 minutes. The thank-you you send ten times a day.",
    "avatar": "AL", "contact": "Alex (COO)", "opener": "Can we move the 3 pm?",
    "board": [
        {"name": "Scheduling", "folder": True, "items": [
            {"name": "Running late", "text": "Running about 10 minutes behind — start without me and I'll join shortly."},
            {"name": "Find 15 min", "text": "Let's find 15 minutes this week. I'm copying Jordan from my office to set it up."},
            {"name": "Move it?", "text": "Could we move this to later in the day? Anything after 3 pm works on my end."},
            {"name": "Invite sent", "text": "Invite sent. The agenda and pre-read are attached — a quick look beforehand would help."},
        ]},
        {"name": "Replies", "folder": True, "items": [
            {"name": "Approved", "text": "Approved. Please proceed and keep me posted on timing."},
            {"name": "Need more", "text": "Before I sign off, send me the numbers behind this and the risks you see."},
            {"name": "Discuss live", "text": "Let's take this live rather than over email. Grab 10 minutes on my calendar."},
            {"name": "Not now", "text": "Not a priority this quarter. Let's revisit in the next planning cycle."},
        ]},
        {"name": "Thank you", "text": "Thank you for the update — I appreciate the clear summary."},
        {"name": "Great work", "text": "Great work on this. Please pass my thanks along to the whole team."},
        {"name": "In transit", "text": "Boarding now. I'll be offline for a few hours and will reply once I land."},
        {"name": "Pre-read", "text": "Please send the deck by end of day [TODAY] so I can review it before we meet."},
        {"name": "Intro", "text": "Happy to make the introduction. Jordan, meet Alex — I'll let you two take it from here."},
        {"name": "Board update", "text": "Quick update for the board: we're on track for the quarter. Details are in the attached memo."},
        {"name": "Signature", "text": "Best,\nMorgan Lee\nChief Executive Officer"},
    ],
}

# The physicians' page in Persian: the same board, its orders written in Persian (lab and drug
# shorthand such as CBC, NPO, stat stays as physicians write it). "~" is a half-space, as in STRINGS.
PHYSICIANS_FA = _half_spaces({
    "path": "connect4",
    "lang": "fa",
    "alternates": {"en": "connect2"},
    "title": "دریافت Ditto — یک مربع را لمس کنید، هر جا جای~گذاری کنید",
    "description": "Ditto را برای آیفون یا اندروید دانلود کنید: تابلویی از مربع~های بزرگ و لمسی برای دستورهایی که بارها و بارها می~نویسید — سرم، آزمایش، شروع آنتی~بیوتیک، پتاسیم — و صفحه~کلیدی که آن~ها را در هر برنامه~ای تایپ می~کند. بدون حساب کاربری، بدون ردیابی.",
    "og_description": "سرم، آزمایش، آنتی~بیوتیک و پتاسیم، با یک لمس. در App Store و Google Play.",
    "eyebrow": "Ditto برای آیفون و اندروید",
    "lede": "Ditto تابلویی از مربع~های بزرگ و لمسی است. هر مربع متنی را نگه می~دارد که بارها و بارها به کار می~برید — یک بولوس سرم، یک دستور آزمایش، شروع یک آنتی~بیوتیک، جایگزینی پتاسیمی که هر روز می~نویسید. آن را لمس کنید تا متن آماده~ی جای~گذاری شود، یا با صفحه~کلید Ditto آن را مستقیم در هر برنامه~ای تایپ کنید.",
    "like_what": "یک بولوس نرمال~سالین. آزمایش~های اورژانسی. یک ست دستور پنومونی. پتاسیمی که هر روز جایگزین می~کنید.",
    "avatar": "م", "contact": "مریم (پرستار)", "opener": "سلام دکتر احمدی، بیمار تخت ۱۲ حالت تهوع دارد. دستور؟",
    "board": [
        {"name": "سرم", "folder": True, "items": [
            {"name": "سرم ۲۰ ساعته", "text": "نرمال~سالین ۵۰ سی~سی در ساعت به مدت ۲۰ ساعت شروع شود. فردا CBC و CMP چک شود."},
            {"name": "بولوس ۵۰۰", "text": "۵۰۰ میلی~لیتر نرمال~سالین همین حالا بولوس شود (stat)."},
            {"name": "بولوس ۱ لیتر", "text": "۱۰۰۰ میلی~لیتر (۱ لیتر) نرمال~سالین همین حالا بولوس شود (stat)."},
            {"name": "در زمان NPO", "text": "تا زمانی که بیمار NPO است، نرمال~سالین ۵۰ سی~سی در ساعت."},
        ]},
        {"name": "آزمایش~ها", "folder": True, "items": [
            {"name": "آزمایش~های پایه", "text": "CBC و CMP روتین چک شود."},
            {"name": "اورژانسی", "text": "CBC و CMP به صورت stat."},
        ]},
        {"name": "پنومونی", "folder": True, "items": [
            {"name": "شک به پنومونی", "text": "همین حالا CXR، و CBC و CMP روتین چک شود. اگر قبلاً سفارش داده نشده، اسپیرومتر تشویقی اضافه شود و نحوه~ی استفاده آموزش داده شود."},
            {"name": "CAP وریدی", "text": "سفتریاکسون ۲ گرم وریدی روزانه به مدت ۷ روز شروع شود. همچنین داکسی~سایکلین خوراکی ۱۰۰ میلی~گرم دو بار در روز به مدت ۷ روز. آنتی~بیوتیک وریدی stat شروع شود.\n\nپروکلسی~تونین، آنتی~ژن استرپتوکوک ادرار و آنتی~ژن لژیونلای ادرار به صورت روتین (غیر stat) چک شود."},
            {"name": "HCAP", "text": "سفپیم ۲ گرم وریدی هر ۸ ساعت به مدت ۷ روز شروع شود. همچنین داکسی~سایکلین خوراکی ۱۰۰ میلی~گرم دو بار در روز به مدت ۷ روز. آنتی~بیوتیک وریدی stat شروع شود.\n\nپروکلسی~تونین، آنتی~ژن استرپتوکوک ادرار و آنتی~ژن لژیونلای ادرار به صورت روتین (غیر stat) چک شود."},
        ]},
        {"name": "تهوع", "folder": True, "items": [
            {"name": "اندانسترون PRN", "text": "اندانسترون ۴ میلی~گرم خوراکی هر ۶ ساعت در صورت نیاز."},
            {"name": "اندانسترون منظم", "text": "اندانسترون ۴ میلی~گرم خوراکی هر ۶ ساعت به صورت منظم برای ۲ روز، سپس در صورت نیاز."},
        ]},
        {"name": "ورم", "folder": True, "items": [
            {"name": "پای چپ", "text": "داپلکس وریدی اندام تحتانی چپ چک شود."},
            {"name": "پای راست", "text": "داپلکس وریدی اندام تحتانی راست چک شود."},
            {"name": "بانداژ پاها", "text": "دستور بانداژ و بالا نگه داشتن پاها:\n\n۱. هر دو پا با باند کشی (ACE) بسته شود:\n\n- از انگشتان شروع کنید و محکم بپیچید تا همه~ی انگشتان کاملاً پوشیده شوند.\n- هر چه بالاتر می~روید فشار را کم کنید، تا درست زیر زانو شل~ترین جای بانداژ باشد.\n- فشار درست روی انگشتان و کف پا برای جلوگیری از بدتر شدن ورم ضروری است.\n\n۲. پاها با بالش بالا نگه داشته شود:\n\n- از دو بالش استفاده کنید.\n- پاها طوری روی بالش~ها قرار بگیرند که کف پا بالاترین نقطه~ی اندام تحتانی باشد.\n\n*** دوباره بررسی کنید که انگشتان کاملاً بانداژ شده~اند و فشار به سمت بالا کم می~شود.\n\n*** مطمئن شوید که پاها بالاتر از بقیه~ی ساق قرار دارند تا تخلیه درست انجام شود و ورم کم شود."},
            {"name": "بانداژ کف پا", "text": "شب~ها هنگام خواب:\n\nلطفاً فقط هر دو کف پای بیمار بانداژ شود. فشار به تدریج کم شود؛ باند کشی روی انگشتان محکم~ترین و در مفصل مچ پا کمترین فشار را داشته باشد. مچ پا یا ساق بانداژ نشود. در طول روز همه~ی بانداژها باز شود.\n\nاین کار ۳ شب انجام شود.\n\nشب~ها پاهای بیمار روی ۲ بالش بالا نگه داشته شود."},
        ]},
        {"name": "پتاسیم", "folder": True, "items": [
            {"name": "یک~بار", "text": "پتاسیم ۴۰ میلی~اکی~والان خوراکی یک~بار (از بیمار بپرسید قرص بزرگ را ترجیح می~دهد یا شربت را؛ اگر اختلال بلع دارد، پتاسیم مایع داده شود.)"},
            {"name": "۲ بار", "text": "پتاسیم ۴۰ میلی~اکی~والان همین حالا، ۴ ساعت بعد دوباره، سپس قطع؛ فردا BMP تکرار شود.\n\n(از بیمار بپرسید قرص بزرگ را ترجیح می~دهد یا شربت را؛ اگر اختلال بلع دارد، پتاسیم مایع داده شود.)"},
            {"name": "۳ بار", "text": "پتاسیم ۴۰ میلی~اکی~والان همین حالا، ۴ ساعت بعد دوباره، و ۴ ساعت بعد بار دیگر، سپس قطع؛ فردا BMP تکرار شود.\n\n(از بیمار بپرسید قرص بزرگ را ترجیح می~دهد یا شربت را؛ اگر اختلال بلع دارد، پتاسیم مایع داده شود.)"},
            {"name": "روزانه", "text": "پتاسیم ۴۰ میلی~اکی~والان روزانه.\n\n(از بیمار بپرسید قرص بزرگ را ترجیح می~دهد یا شربت را؛ اگر اختلال بلع دارد، پتاسیم مایع داده شود.)"},
        ]},
        {"name": "افت فشار", "folder": True, "items": [
            {"name": "میدودرین ۲٫۵", "text": "میدودرین ۲٫۵ میلی~گرم سه بار در روز، ساعت ۷ صبح، ۱۱ صبح و ۴ بعدازظهر. اگر پیش از دادن دارو فشار سیستولیک بالای ۱۴۰ بود، داده نشود."},
            {"name": "میدودرین ۵", "text": "میدودرین ۵ میلی~گرم سه بار در روز، ساعت ۷ صبح، ۱۱ صبح و ۴ بعدازظهر. اگر پیش از دادن دارو فشار سیستولیک بالای ۱۴۰ بود، داده نشود."},
            {"name": "دروکسی~دوپا", "text": "دروکسی~دوپا ۱۰۰ میلی~گرم دو بار در روز، ساعت ۷ صبح و ۱۲ ظهر. اگر پیش از دادن دارو فشار سیستولیک بالای ۱۴۰ بود، داده نشود. با سر تخت بالا بخوابد."},
            {"name": "فلودروکورتیزون", "text": "فلودروکورتیزون ۰٫۱ میلی~گرم خوراکی روزانه، ساعت ۸ صبح. اگر فشار سیستولیک بالای ۱۴۰ بود، داده نشود.\n\nفردا BMP چک شود، سپس هفتگی برای پایش پتاسیم."},
        ]},
        {"name": "یبوست", "folder": True, "items": [
            {"name": "پلی~اتیلن گلیکول", "text": "لطفاً پلی~اتیلن گلیکول (میرالاکس) ۱۷ گرم خوراکی روزانه اضافه شود."},
            {"name": "پروتکل روده", "text": "لطفاً پروتکل روده شروع شود."},
            {"name": "انما ۱ بار", "text": "لطفاً همین حالا انمای آب و صابون داده شود؛ اگر در دسترس نبود، یک~بار انمای فلیت داده شود."},
        ]},
        {"name": "اسپیرومتر تشویقی", "text": "لطفاً یک اسپیرومتر تشویقی سفارش داده شود و نحوه~ی استفاده به بیمار آموزش داده شود."},
    ],
})

PERSONAS = [GENERIC, EDUCATORS, PHYSICIANS, EXECUTIVES, PHYSICIANS_FA]
