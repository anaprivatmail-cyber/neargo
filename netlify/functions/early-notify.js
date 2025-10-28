// Serverless funkcija za predčasna obvestila Premium uporabnikom
// Cron job: preveri ponudbe s časom javne objave in pošlje obvestila Premium uporabnikom X ur prej

const { getPremiumUsers, getUpcomingOffers, sendNotification } = require("./utils");

// Koliko ur pred objavo pošiljamo obvestila
const HOURS_BEFORE = 6;

exports.handler = async function(event, context) {
  // 1. Pridobi vse Premium uporabnike in njihove kategorije
  const users = await getPremiumUsers(); // [{email, earlyNotifyCategories: ["koncerti", ...]}]
  if (!users || !users.length) return { statusCode: 200, body: "No premium users." };

  // 2. Pridobi ponudbe, ki bodo objavljene v naslednjih HOURS_BEFORE urah
  const offers = await getUpcomingOffers(HOURS_BEFORE); // [{id, name, category, publishAt, ...}]
  if (!offers || !offers.length) return { statusCode: 200, body: "No upcoming offers." };

  // 3. Za vsakega uporabnika preveri, če ima izbrano kategorijo in pošlji obvestilo
  let notified = 0;
  for (const user of users) {
    const relevantOffers = offers.filter(o => user.earlyNotifyCategories?.includes(o.category));
    for (const offer of relevantOffers) {
      await sendNotification(user.email, offer); // Pošlji email ali push
      notified++;
    }
  }

  return {
    statusCode: 200,
    body: `Sent ${notified} notifications.`
  };
};

// Opomba: Implementacija funkcij getPremiumUsers, getUpcomingOffers, sendNotification je v utils.js ali v bazi.
