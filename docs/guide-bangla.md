# Phone-settings guide: Bangla wording to proofread

The app shows this guide in Bangla first, with a **বাংলা | English** switch at the top. This page lists every Bangla line next to its English line so someone who reads Bangla can check the wording without opening code. If you change a line, tell Claude (or edit `android/app/src/main/java/com/paytrace/app/GuideText.kt`).

**Rule:** the phone's own screens are usually in English, so every menu and option name the partner must find or tap stays in English, in quotes. Bangla explains around it. Please do not translate those quoted names.

## Steps

### `lock`
| | English | বাংলা |
|---|---|---|
| Title | Lock PayTrace in the recent-apps screen | Recent apps-এ PayTrace লক করে রাখুন |
| Where | Open the recent-apps screen (swipe up from the bottom and hold) and find PayTrace | Recent apps খুলুন (স্ক্রিনের নিচ থেকে উপরে টেনে ধরে রাখুন) এবং PayTrace খুঁজে নিন |
| Choose | Pull PayTrace's card down, or tap the small lock icon, until a lock shows on the card | PayTrace-এর কার্ডটি নিচের দিকে টানুন, অথবা ছোট তালা (lock) আইকনে চাপ দিন, যতক্ষণ কার্ডে তালা না দেখা যায় |
| Not | – | – |
| Why | Phone cleaning skips locked apps, so it cannot close PayTrace. | ফোন পরিষ্কার (clean) করার সময় লক করা অ্যাপ বাদ থাকে, তাই PayTrace বন্ধ হয় না। |

### `vivo_bg`
| | English | বাংলা |
|---|---|---|
| Title | Let PayTrace use battery in the background | PayTrace-কে ব্যাকগ্রাউন্ডে ব্যাটারি ব্যবহার করতে দিন |
| Where | Settings > Battery > Background power consumption management > PayTrace | Settings > Battery > Background power consumption management > PayTrace |
| Choose | Allow high background power consumption | "Allow high background power consumption" |
| Not | Optimized (or Smart): with these the phone closes PayTrace when the screen is off | "Optimized" বা "Smart": এগুলো থাকলে স্ক্রিন বন্ধ হলে ফোন PayTrace বন্ধ করে দেয় |
| Why | This is the setting that stopped PayTrace on Vivo phones. | ভিভো ফোনে PayTrace এই সেটিং-এর কারণেই বন্ধ হয়ে গিয়েছিল। |

### `vivo_autostart`
| | English | বাংলা |
|---|---|---|
| Title | Let PayTrace start by itself | PayTrace-কে নিজে থেকে চালু হতে দিন |
| Where | Settings > Apps & permissions > Autostart (or i Manager > App manager > Autostart) | Settings > Apps & permissions > Autostart (অথবা i Manager > App manager > Autostart) |
| Choose | Switch PayTrace ON | PayTrace-এর পাশের সুইচটি ON করুন |
| Not | – | – |
| Why | Without it PayTrace cannot start again after the phone stops it. | এটা না থাকলে ফোন একবার বন্ধ করে দিলে PayTrace আর নিজে থেকে চালু হতে পারে না। |

### `vivo_saver`
| | English | বাংলা |
|---|---|---|
| Title | Turn off the power-saving modes | পাওয়ার সেভিং মোড বন্ধ রাখুন |
| Where | Settings > Battery | Settings > Battery |
| Choose | Super power saving and Ultra power saving: OFF | "Super power saving" এবং "Ultra power saving": দুটোই OFF |
| Not | – | – |
| Why | These close every app in the background. | এই মোড চালু থাকলে ব্যাকগ্রাউন্ডের সব অ্যাপ বন্ধ হয়ে যায়। |

### `op_battery`
| | English | বাংলা |
|---|---|---|
| Title | Do not optimise PayTrace's battery use | PayTrace-এর ব্যাটারি অপটিমাইজ করবেন না |
| Where | Settings > Battery > Battery optimization > PayTrace | Settings > Battery > Battery optimization > PayTrace |
| Choose | Don't optimize | "Don't optimize" |
| Not | Optimize | "Optimize" |
| Why | Optimised apps are stopped when the screen is off. | অপটিমাইজ করা অ্যাপ স্ক্রিন বন্ধ হলে ফোন বন্ধ করে দেয়। |

### `op_bg`
| | English | বাংলা |
|---|---|---|
| Title | Allow background activity and auto-launch | ব্যাকগ্রাউন্ড অ্যাক্টিভিটি ও অটো-লঞ্চ চালু করুন |
| Where | Settings > Apps > App management > PayTrace > Battery usage | Settings > Apps > App management > PayTrace > Battery usage |
| Choose | Allow background activity: ON, and Allow auto-launch: ON | "Allow background activity": ON এবং "Allow auto-launch": ON |
| Not | – | – |
| Why | Lets PayTrace keep running and start again on its own. | এতে PayTrace চলতে থাকে এবং বন্ধ হয়ে গেলে নিজে থেকে আবার চালু হয়। |

### `op_sleep`
| | English | বাংলা |
|---|---|---|
| Title | Turn off the sleep optimisations | স্লিপ অপটিমাইজেশন বন্ধ করুন |
| Where | Settings > Battery > More battery settings | Settings > Battery > More battery settings |
| Choose | Sleep standby optimization: OFF, and Deep optimization: OFF | "Sleep standby optimization": OFF এবং "Deep optimization": OFF |
| Not | – | – |
| Why | They freeze apps while the screen is off. | এগুলো চালু থাকলে স্ক্রিন বন্ধ অবস্থায় অ্যাপ জমে (freeze) যায়। |

### `xi_autostart`
| | English | বাংলা |
|---|---|---|
| Title | Let PayTrace start by itself | PayTrace-কে নিজে থেকে চালু হতে দিন |
| Where | Settings > Apps > Manage apps > PayTrace > Autostart | Settings > Apps > Manage apps > PayTrace > Autostart |
| Choose | Switch it ON | সুইচটি ON করুন |
| Not | – | – |
| Why | Without it PayTrace cannot start again after the phone stops it. | এটা না থাকলে ফোন একবার বন্ধ করে দিলে PayTrace আর নিজে থেকে চালু হতে পারে না। |

### `xi_saver`
| | English | বাংলা |
|---|---|---|
| Title | Remove the battery restriction | ব্যাটারির বিধিনিষেধ তুলে দিন |
| Where | Settings > Apps > Manage apps > PayTrace > Battery saver | Settings > Apps > Manage apps > PayTrace > Battery saver |
| Choose | No restrictions | "No restrictions" |
| Not | Battery saver or Restricted | "Battery saver" বা "Restricted" |
| Why | Restricted apps are stopped in the background. | "Restricted" অ্যাপ ব্যাকগ্রাউন্ডে বন্ধ করে দেওয়া হয়। |

### `sa_never`
| | English | বাংলা |
|---|---|---|
| Title | Add PayTrace to the never-sleeping apps | PayTrace-কে "Never sleeping apps"-এর তালিকায় যোগ করুন |
| Where | Settings > Battery > Background usage limits > Never sleeping apps | Settings > Battery > Background usage limits > Never sleeping apps |
| Choose | Add PayTrace to the list | তালিকায় PayTrace যোগ করুন |
| Not | PayTrace listed under Sleeping apps or Deep sleeping apps | PayTrace যদি "Sleeping apps" বা "Deep sleeping apps"-এর তালিকায় থাকে, সেখান থেকে সরান |
| Why | Sleeping apps are stopped in the background. | "Sleeping apps"-এর অ্যাপ ব্যাকগ্রাউন্ডে বন্ধ করে দেওয়া হয়। |

### `sa_unused`
| | English | বাংলা |
|---|---|---|
| Title | Stop unused apps being put to sleep | অব্যবহৃত অ্যাপকে ঘুম পাড়ানো বন্ধ করুন |
| Where | Settings > Battery > Background usage limits | Settings > Battery > Background usage limits |
| Choose | Put unused apps to sleep: OFF | "Put unused apps to sleep": OFF |
| Not | – | – |
| Why | Otherwise Samsung puts PayTrace to sleep when you do not open it. | না হলে আপনি PayTrace না খুললে স্যামসাং সেটিকে ঘুম পাড়িয়ে দেয়। |

### `tr_auto`
| | English | বাংলা |
|---|---|---|
| Title | Let PayTrace start by itself | PayTrace-কে নিজে থেকে চালু হতে দিন |
| Where | Phone Master (or Settings) > Autostart manager | Phone Master (অথবা Settings) > Autostart manager |
| Choose | Switch PayTrace ON | PayTrace-এর সুইচটি ON করুন |
| Not | – | – |
| Why | Without it PayTrace cannot start again after the phone stops it. | এটা না থাকলে ফোন একবার বন্ধ করে দিলে PayTrace আর নিজে থেকে চালু হতে পারে না। |

### `tr_batt`
| | English | বাংলা |
|---|---|---|
| Title | Remove the battery restriction | ব্যাটারির বিধিনিষেধ তুলে দিন |
| Where | Settings > Apps > PayTrace > Battery | Settings > Apps > PayTrace > Battery |
| Choose | No restrictions (or Don't optimise), and allow background activity | "No restrictions" (অথবা "Don't optimise") বাছুন এবং ব্যাকগ্রাউন্ড অ্যাক্টিভিটির অনুমতি দিন |
| Not | Optimised | "Optimised" |
| Why | Optimised apps are stopped when the screen is off. | অপটিমাইজ করা অ্যাপ স্ক্রিন বন্ধ হলে ফোন বন্ধ করে দেয়। |

### `tr_power`
| | English | বাংলা |
|---|---|---|
| Title | Allow PayTrace in app power management | App power management-এ PayTrace-কে অনুমতি দিন |
| Where | Phone Master > Battery > App power management (if your phone lists it) | Phone Master > Battery > App power management (আপনার ফোনে থাকলে) |
| Choose | Set PayTrace to Allow or Always run | PayTrace-কে "Allow" অথবা "Always run" করুন |
| Not | – | – |
| Why | Some Tecno, Infinix and itel phones have a separate list that closes apps. | কিছু Tecno, Infinix ও itel ফোনে আলাদা একটি তালিকা আছে, যা অ্যাপ বন্ধ করে দেয়। |

### `hu_launch`
| | English | বাংলা |
|---|---|---|
| Title | Let PayTrace run on its own | PayTrace-কে নিজে থেকে চলতে দিন |
| Where | Settings > Battery > App launch > PayTrace | Settings > Battery > App launch > PayTrace |
| Choose | Manage manually, then turn ON Auto-launch, Secondary launch and Run in background | "Manage manually" বাছুন, তারপর "Auto-launch", "Secondary launch" ও "Run in background" ON করুন |
| Not | Automatic | "Automatic" |
| Why | Automatic management closes apps in the background. | "Automatic" থাকলে ফোন নিজে থেকে ব্যাকগ্রাউন্ডের অ্যাপ বন্ধ করে দেয়। |

### `gen_batt`
| | English | বাংলা |
|---|---|---|
| Title | Remove the battery restriction | ব্যাটারির বিধিনিষেধ তুলে দিন |
| Where | Settings > Apps > PayTrace > Battery | Settings > Apps > PayTrace > Battery |
| Choose | No restrictions (or Don't optimize) | "No restrictions" (অথবা "Don't optimize") |
| Not | Optimized or Restricted | "Optimized" বা "Restricted" |
| Why | Restricted apps are stopped in the background. | "Restricted" অ্যাপ ব্যাকগ্রাউন্ডে বন্ধ করে দেওয়া হয়। |

### `gen_auto`
| | English | বাংলা |
|---|---|---|
| Title | Allow auto-start if the phone has it | ফোনে থাকলে অটো-স্টার্ট চালু করুন |
| Where | Settings > Apps > PayTrace (look for Autostart, Auto-launch or Background activity) | Settings > Apps > PayTrace (এখানে "Autostart", "Auto-launch" বা "Background activity" খুঁজুন) |
| Choose | Switch it ON | সুইচটি ON করুন |
| Not | – | – |
| Why | Lets PayTrace start again on its own. | এতে PayTrace বন্ধ হয়ে গেলে নিজে থেকে আবার চালু হতে পারে। |

## Words on the screen

| English | বাংলা |
|---|---|
| Where: | কোথায়: |
| Choose: | বেছে নিন: |
| Not: | বেছে নেবেন না: |
| Open this page | এই পেজটি খুলুন |
| Opened: | খুলেছে: |
| Not the right page? Try another | ভুল পেজ? অন্যটি চেষ্টা করুন |
| Start again from the first page | প্রথম পেজ থেকে আবার শুরু করুন |
| Open PayTrace's app page | PayTrace-এর অ্যাপ পেজ খুলুন |
| I did this | আমি এটা করেছি |
| ✓ Done | ✓ হয়ে গেছে |
| Undo | ফিরিয়ে নিন |
| ✓ The phone confirms this one | ✓ ফোন নিজেই নিশ্চিত করেছে |
| Phone check | ফোন চেক |
| This is what Android reports. Your phone brand's own power manager is checked by the screen-off test below. | অ্যান্ড্রয়েড নিজে যা জানায়, এখানে তা-ই দেখানো হয়েছে। ফোন কোম্পানির নিজস্ব পাওয়ার ম্যানেজার নিচের স্ক্রিন-অফ টেস্টে পরীক্ষা হয়। |
| Wording differs a little between phone models. If a page is wrong or empty, tap "Try another page"; the last choices are PayTrace's own app page and the phone's Settings, which every phone has. | ফোনের মডেল অনুযায়ী লেখা একটু আলাদা হতে পারে। কোনো পেজ ভুল বা খালি খুললে "ভুল পেজ? অন্যটি চেষ্টা করুন" চাপুন। শেষ দুটি অপশন PayTrace-এর অ্যাপ পেজ ও ফোনের Settings, যা সব ফোনেই আছে। |
| Screen-off test | স্ক্রিন-অফ টেস্ট |
| Recommended. Start the test, lock the phone and leave it for 10 minutes. PayTrace then tells you whether the phone stopped it, which is what the settings above are for. | প্রস্তাবিত। টেস্ট শুরু করে ফোন লক করুন এবং 10 মিনিট রেখে দিন। ওপরের সেটিংগুলো কাজ করেছে কি না, PayTrace তখন আপনাকে জানাবে। |
| Start the 10-minute test | 10 মিনিটের টেস্ট শুরু করুন |
| Test again | আবার টেস্ট করুন |
| Cancel the test | টেস্ট বাতিল করুন |

## Screen-off test and progress (the numbers are filled in by the app)

| English | বাংলা |
|---|---|
| All $total settings are done. Thank you. | সবগুলো ($total টি) সেটিং শেষ। ধন্যবাদ। |
| $finished of $total settings done | $total টির মধ্যে $finished টি সেটিং শেষ |
| Test running. Lock the phone now and put it down. Come back in about $minutesLeft minute(s) and open PayTrace to see the result. | টেস্ট চলছে। এখনই ফোন লক করে রেখে দিন। আরও প্রায় $minutesLeft মিনিট পর PayTrace খুলে ফলাফল দেখুন। |
| ✓ Passed$whenText: PayTrace kept running with the screen off for $offMin minutes. The longest silence was $gapS seconds. | ✓ পাস$whenText: স্ক্রিন বন্ধ থাকা অবস্থায় $offMin মিনিট PayTrace চালু ছিল। সবচেয়ে বড় বিরতি ছিল $gapS সেকেন্ড। |
| Failed$whenText: PayTrace was silent for $gapS seconds, so the phone stopped it. Go through the settings above again, then test again. | ফেল$whenText: PayTrace $gapS সেকেন্ড চুপ ছিল, অর্থাৎ ফোন এটি বন্ধ করে দিয়েছিল। ওপরের সেটিংগুলো আবার দেখুন, তারপর আবার টেস্ট করুন। |
| The test could not tell: the screen was off for only $offMin minutes. Lock the phone and leave it the whole time. | টেস্ট নিশ্চিত হতে পারেনি: স্ক্রিন মাত্র $offMin মিনিট বন্ধ ছিল। পুরো সময় ফোন লক করে রাখুন। |

## Names shown after "Opened:"

| Page | বাংলা |
|---|---|
| PayTrace's own app page (open Battery or Permissions from here) | PayTrace-এর নিজের অ্যাপ পেজ (এখান থেকে Battery বা Permissions খুলুন) |
| the phone's Settings home (search for the setting's name) | ফোনের Settings-এর হোম (সেটিং-এর নাম লিখে খুঁজুন) |
| the "allow PayTrace to run in the background" question | "PayTrace-কে ব্যাকগ্রাউন্ডে চলতে দিন" প্রশ্নটি |
| the battery optimisation list (choose "All apps", then PayTrace) | ব্যাটারি অপটিমাইজেশনের তালিকা ("All apps" বেছে PayTrace খুঁজুন) |
| the battery saver page | ব্যাটারি সেভার পেজ |
| the battery usage page | ব্যাটারি ব্যবহারের পেজ |
| Vivo: apps allowed high background power use | ভিভো: যে অ্যাপ বেশি ব্যাকগ্রাউন্ড পাওয়ার ব্যবহার করতে পারে |
| Vivo: background startup manager | ভিভো: ব্যাকগ্রাউন্ড স্টার্টআপ ম্যানেজার |
| Vivo: permission manager | ভিভো: পারমিশন ম্যানেজার |
| OnePlus: auto-launch list | ওয়ানপ্লাস: অটো-লঞ্চের তালিকা |
| ColorOS: startup apps list | ColorOS: স্টার্টআপ অ্যাপের তালিকা |
| ColorOS: startup apps list | ColorOS: স্টার্টআপ অ্যাপের তালিকা |
| Oppo: startup apps list | অপো: স্টার্টআপ অ্যাপের তালিকা |
| ColorOS: power usage settings | ColorOS: পাওয়ার ব্যবহারের সেটিং |
| Xiaomi: Autostart manager | শাওমি: অটোস্টার্ট ম্যানেজার |
| Xiaomi: PayTrace's battery saver choice | শাওমি: PayTrace-এর ব্যাটারি সেভার সেটিং |
| Samsung: Device care battery page | স্যামসাং: ডিভাইস কেয়ারের ব্যাটারি পেজ |
| Samsung: Device care battery page | স্যামসাং: ডিভাইস কেয়ারের ব্যাটারি পেজ |
| Huawei: startup manager | হুয়াওয়ে: স্টার্টআপ ম্যানেজার |
| Huawei: protected apps | হুয়াওয়ে: প্রোটেক্টেড অ্যাপ |
| Huawei: power manager | হুয়াওয়ে: পাওয়ার ম্যানেজার |
| Phone Master: autostart manager | Phone Master: অটোস্টার্ট ম্যানেজার |
| Transsion: autostart manager | Transsion: অটোস্টার্ট ম্যানেজার |
| HiOS: autostart manager | HiOS: অটোস্টার্ট ম্যানেজার |
| Asus: autostart manager | আসুস: অটোস্টার্ট ম্যানেজার |
