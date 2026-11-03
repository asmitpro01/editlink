# EditLink

**Video editors ke liye client review — WhatsApp pe.**
Client ko ek link bhejo. Wo bina login video dekhe, video pe timestamp comment ya voice note de, aur ek tap mein approve kare. Free rounds ke baad har extra revision ka paisa UPI se.

## Kya kya hai (v0.1)
| Feature | Kaise |
|---|---|
| Review link | Project banao → client link + aapka private dashboard link |
| WhatsApp share | Ready-made message ke saath `wa.me` button |
| Timestamp comments | YouTube / .mp4 pe time apne aap; Google Drive pe time khud likho |
| Voice note | Client mic se bolke feedback de |
| To-do list | Dashboard pe har comment checkbox ke saath, time pe click = video wahin |
| AI task list | Optional — koi bhi OpenAI-compatible API (neeche dekho) |
| Revision rounds | Free rounds set karo; uske baad har round ka ₹ fee |
| UPI payment | Client page pe `upi://pay` button (GPay/PhonePe/Paytm khulta hai) |
| Approve | Approve ke baad comments band |

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

## AI task list (optional)
Ye env variables set karo (koi bhi OpenAI-compatible provider):
```
AI_BASE_URL=https://api.groq.com/openai/v1      # ya Gemini: https://generativelanguage.googleapis.com/v1beta/openai
AI_API_KEY=...
AI_MODEL=openai/gpt-oss-120b                    # ya gemini-2.5-flash
```
Na set karo to bhi chalega — comments time ke hisaab se list ban jayenge.

## Aage ka plan
- Editor login + multiple projects ek account mein
- Voice note → text (speech-to-text)
- Razorpay/UPI AutoPay subscription (₹299–499/mahina)
- Video upload (abhi link chahiye)
