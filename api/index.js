const { Telegraf } = require('telegraf');
const { google } = require('googleapis');

// Botni sozlash
const bot = new Telegraf(process.env.BOT_TOKEN);
const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.GoogleAuth({
    keyFile: './credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  })
});
const spreadsheetId = process.env.SPREADSHEET_ID;

// Google Sheets’dan ma’lumot olish
async function getSheetData(range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });
  return response.data.values || [];
}

// Google Sheets’ga ma’lumot yozish
async function appendSheetData(range, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    resource: { values }
  });
}

// Start buyrug‘i
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const users = await getSheetData('Users!A:D');
  const userExists = users.find(row => row[0] === userId.toString());

  if (!userExists) {
    await appendSheetData('Users!A:D', [[
      userId,
      JSON.stringify([]),
      new Date().toISOString(),
      new Date().toISOString()
    ]]);
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Multfilm izlash', switch_inline_query_current_chat: '' }],
        [{ text: 'Statistika (Admin)', callback_data: 'admin_stats' }]
      ]
    }
  };
  await ctx.reply('Xush kelibsiz! Multfilm izlash uchun tugmani bosing:', keyboard);
});

// Qidiruv funksiyasi
bot.on('inline_query', async (ctx) => {
  const query = ctx.inlineQuery.query.toLowerCase();
  const contents = await getSheetData('Content!A:E');
  const filtered = contents.filter(row => row[1].toLowerCase().includes(query));

  const results = filtered.map((row, index) => ({
    type: 'article',
    id: String(index),
    title: row[1],
    description: row[2] === 'series' ? `Qism ${row[3] || 'N/A'}` : 'Multfilm',
    input_message_content: {
      message_text: `Siz ${row[1]} ni tanladingiz. Batafsil ma'lumot uchun tugmani bosing.`,
    },
    reply_markup: {
      inline_keyboard: [[
        { text: 'Ko\'rish', callback_data: `view_${row[0]}` }
      ]]
    }
  }));

  await ctx.answerInlineQuery(results);
});

// Kontentni ko‘rish va obuna tekshiruvi
bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;

  if (data.startsWith('view_')) {
    const postId = data.split('_')[1];
    const contents = await getSheetData('Content!A:E');
    const content = contents.find(row => row[0] === postId);

    // Obunalarni tekshirish
    const users = await getSheetData('Users!A:D');
    const user = users.find(row => row[0] === userId.toString());
    const subscribedChannels = JSON.parse(user[1] || '[]');
    const mandatoryChannels = (await getSheetData('MandatoryChannels!A:A')).map(row => row[0]);

    const unsubscribed = mandatoryChannels.filter(
      channel => !subscribedChannels.includes(channel)
    );

    if (unsubscribed.length > 0) {
      const keyboard = {
        reply_markup: {
          inline_keyboard: unsubscribed.map(channel => [{
            text: `Obuna bo'lish: ${channel}`,
            url: `https://t.me/${channel}`
          }])
        }
      };
      await ctx.reply('Iltimos, quyidagi kanallarga obuna bo\'ling:', keyboard);
      return;
    }

    // Kontentni yuborish
    await ctx.telegram.forwardMessage(
      ctx.from.id,
      content[4], // base_channel_id
      parseInt(content[0]) // post_id
    );

    // Foydalanuvchi faolligini yangilash
    const userIndex = users.findIndex(row => row[0] === userId.toString());
    users[userIndex][3] = new Date().toISOString();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Users!A${userIndex + 2}:D${userIndex + 2}`,
      valueInputOption: 'RAW',
      resource: { values: [users[userIndex]] }
    });
  } else if (data === 'admin_stats' && userId === parseInt(process.env.ADMIN_ID)) {
    const stats = await getSheetData('Stats!A:G');
    const latest = stats[stats.length - 1] || ['N/A', 0, 0, 0, 0, 0, 0];
    await ctx.reply(
      `Statistika:\n` +
      `Umumiy foydalanuvchilar: ${latest[1]}\n` +
      `Bugun qo'shilgan: ${latest[2]}\n` +
      `Haftalik qo'shilgan: ${latest[3]}\n` +
      `Oylik qo'shilgan: ${latest[4]}\n` +
      `Aktiv: ${latest[5]}\n` +
      `Nofaol: ${latest[6]}`
    );
  }

  await ctx.answerCbQuery();
});

// Admin: Kanal qo‘shish
bot.command('addchannel', async (ctx) => {
  if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) return;
  const channel = ctx.message.text.split(' ')[1];
  if (channel) {
    await appendSheetData('MandatoryChannels!A:A', [[channel]]);
    await ctx.reply(`Kanal qo'shildi: ${channel}`);
  }
});

// Admin: Kontent qo‘shish
bot.command('addcontent', async (ctx) => {
  if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) return;
  const [_, title, type, episode, postId] = ctx.message.text.split(' ');
  await appendSheetData('Content!A:E', [[
    postId,
    title,
    type,
    episode || '',
    process.env.BASE_CHANNEL_ID
  ]]);
  await ctx.reply(`Kontent qo'shildi: ${title}`);
});

// Vercel serverless funksiyasi
module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
};