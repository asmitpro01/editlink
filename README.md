# EditLink

**Video editors ke liye client review — WhatsApp pe.**
Client ko ek link bhejo. Wo bina login video dekhe, video pe timestamp comment ya voice note de, aur ek tap mein approve kare. Free rounds ke baad har extra revision ka paisa UPI se.

## Kya kya hai (v0.2)
| Feature | Kaise kaam karta hai |
|---|---|
| 🔒 Paisa nahi to file nahi | Client preview pe watermark. Final download link tabhi dikhta hai jab approve + pura payment ho |
| ✏️ Video pe draw | Client video rok ke frame pe gola/arrow banata hai, time ke saath save |
| 🎤 Voice note | Bolke feedback. Optional: apne aap text mein (speech-to-text) |
| 🆚 V1 vs V2 | Purana aur naya version side-by-side, ek saath chalao |
| 📜 Approval certificate | Client naam likh ke approve karta hai; time, version aur verification code ke saath printable certificate |
| ₹ Revision meter | Project fee + advance + free rounds; uske baad har round ka charge apne aap bill mein |
| UPI pay button | Client page pe baaki amount ka `upi://pay` button |
| WhatsApp templates | Video bhejo / reminder / payment yaad dilao — ek tap |
| 👀 Client ne dekha | Pata chalta hai client ne link khola ya nahi |
| Editor dashboard | Phone + PIN login, saare projects, baaki paisa, mila paisa |
| To-do + reply | Har comment checkbox, client ko reply, ✨ smart task list (optional AI) |

## Chalao (apne laptop pe)
Node.js 22.5 ya naya chahiye. Koi `npm install` nahi chahiye — zero dependencies.
```bash
npm start          # http://localhost:3000
npm test           # smoke test
```

## Free mein online daalo (Render)
1. render.com pe GitHub se login → **New → Web Service** → ye repo chuno.
2. Build command: *(khaali)* · Start command: `npm start`
3. Data rakhne ke liye ek Disk add karo aur env `DATA_DIR=/var/data` set karo (free plan pe disk nahi milti, to restart pe data ud sakta hai — pehle test ke liye theek hai).

## AI (optional)
Ye env variables set karo (koi bhi OpenAI-compatible provider):
```
AI_BASE_URL=https://api.groq.com/openai/v1      # ya Gemini: https://generativelanguage.googleapis.com/v1beta/openai
AI_API_KEY=...
AI_MODEL=openai/gpt-oss-120b                    # ya gemini-2.5-flash
```
Voice note ko text mein badalne ke liye:
```
STT_BASE_URL=https://api.groq.com/openai/v1
STT_API_KEY=...
STT_MODEL=whisper-large-v3
```
Na set karo to bhi sab chalega.

> Note: watermark preview ko screen-recording se poori tarah nahi rok sakta — asli suraksha ye hai ki HD final file ka link payment tak chhupa rehta hai.

## Aage ka plan
- Voice note → text (speech-to-text)
- Razorpay/UPI AutoPay subscription (₹299–499/mahina)
- Video upload (abhi link chahiye)
