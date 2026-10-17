// Prints a new VAPID key pair for push notifications, ready to append to .env (docs/NOTIFICATIONS.md).
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
# Contact push services can reach you at about your notifications: a mailto: address or your site's https URL.
VAPID_SUBJECT=mailto:you@example.com`);
