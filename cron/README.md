# Cron Kantor AI (macOS launchd)

## Tick — setiap 5 menit (JALANKAN SEKARANG)

```bash
cp cron/id.kantor.tick.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/id.kantor.tick.plist
```

Cek: `tail -f data/wake.log`. Berhentikan:
`launchctl unload ~/Library/LaunchAgents/id.kantor.tick.plist`.
Aman dari tumpang-tindih: orchestrator melewati divisi yang masih `running`.

## Digest 07:00 — SETELAH bot Telegram siap (JANGAN load dulu)

1. Chat ke `@BotFather` di Telegram → `/newbot` → catat token.
2. Chat ke `@userinfobot` → catat `chat_id` kamu.
3. Tambahkan ke `~/.zshrc` (atau `.env` yang dibaca cron — plist memakai
   environment launchd, jadi taruh di `~/.zshrc` TIDAK terbaca cron;
   gunakan `launchctl setenv TELEGRAM_BOT_TOKEN xxx` + `..._CHAT_ID yyy`).
4. Test manual: `TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=y node scripts/digest.mjs`
5. Kalau terkirim, load plist digest seperti tick di atas.
