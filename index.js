import {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
  SlashCommandBuilder, PermissionFlagsBits, REST, Routes, ActivityType
} from "discord.js";
import fs from 'fs';
import http from 'http';
import Database from "better-sqlite3";

// ===== إصلاح Railway - لا تحذفه =====
http.createServer((_, res) => res.end('Bot is Alive')).listen(process.env.PORT || 3000);

if (!fs.existsSync('/data')) fs.mkdirSync('/data', { recursive: true });
const db = new Database('/data/roles.db');

// ===== قواعد البيانات =====
db.exec(`CREATE TABLE IF NOT EXISTS roles (
  userId TEXT PRIMARY KEY,
  roleId TEXT,
  name TEXT,
  color TEXT,
  color2 TEXT,
  icon TEXT,
  members TEXT,
  createdAt INTEGER,
  createdBy TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS pending_boost_loss (
  userId TEXT PRIMARY KEY,
  roleId TEXT,
  guildId TEXT,
  channelId TEXT,
  messageId TEXT,
  createdAt INTEGER,
  reminded INTEGER DEFAULT 0,
  action TEXT
)`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key =?').get(key)?.value;
const setSetting = (key, value) => db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, value);
const isManager = (userId) => JSON.parse(getSetting('managers') || '[]').includes(userId);
const isBooster = (member) => member.premiumSince || isManager(member.id);

const parseIcon = (input) => {
  if (!input) return null;
  if (input.startsWith('http')) return input;
  const match = input.match(/<a?:\w+:(\d+)>/);
  if (match) return `https://cdn.discordapp.com/emojis/${match[1]}.webp?quality=lossless`;
  if (/^\d{17,20}$/.test(input)) return `https://cdn.discordapp.com/emojis/${input}.webp?quality=lossless`;
  return null;
};

const logAction = async (guild, text) => {
  const logId = getSetting('logChannel');
  if (!logId) return;
  const channel = await guild.channels.fetch(logId).catch(() => null);
  if (channel) {
    channel.send({ embeds: [new EmbedBuilder().setDescription(text).setColor(0x2B2D31).setTimestamp()] });
  }
};

// ===== الأوامر =====
const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('لوحة تحكم البوت'),
  new SlashCommandBuilder().setName('roles').setDescription('إرسال لوحة الرولات للداعمين'),
  new SlashCommandBuilder().setName('ping').setDescription('فحص سرعة البوت')
].map(cmd => cmd.toJSON());

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} جاهز`);

  // ===== الحالة الجديدة =====
  client.user.setPresence({
    activities: [{ name: 'Dev By Cho', type: ActivityType.Watching }],
    status: 'online'
  });

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  // فحص التذكيرات كل ساعة
  setInterval(checkReminders, 3600000);
  checkReminders();
});

// ===== تذكير بعد 3 أيام =====
async function checkReminders() {
  const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
  const pendings = db.prepare('SELECT * FROM pending_boost_loss WHERE createdAt <? AND reminded = 0 AND action IS NULL').all(threeDaysAgo);

  for (const pending of pendings) {
    try {
      const guild = await client.guilds.fetch(pending.guildId);
      const channel = await guild.channels.fetch(pending.channelId);
      const managers = JSON.parse(getSetting('managers') || '[]');
      const mentions = managers.map(id => `<@${id}>`).join(' ');

      await channel.send({
        content: `🔔 ${mentions}`,
        embeds: [new EmbedBuilder()
        .setTitle('تذكير: لم يتم اتخاذ إجراء')
        .setDescription(`العضو <@${pending.userId}> فقد البوست منذ 3 أيام`)
        .setColor(0xFFA500)],
        reply: { messageReference: pending.messageId }
      });

      db.prepare('UPDATE pending_boost_loss SET reminded = 1 WHERE userId =?').run(pending.userId);
    } catch (e) {}
  }
}

// ===== كشف فقدان البوست =====
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (oldMember.premiumSince &&!newMember.premiumSince) {
    const data = db.prepare('SELECT * FROM roles WHERE userId =?').get(newMember.id);
    if (!data) return;

    const logId = getSetting('logChannel');
    if (!logId) return;

    const logChannel = await newMember.guild.channels.fetch(logId).catch(() => null);
    if (!logChannel) return;

    const role = await newMember.guild.roles.fetch(data.roleId).catch(() => null);
    const managers = JSON.parse(getSetting('managers') || '[]');
    const mentions = managers.map(id => `<@${id}>`).join(' ') || '@here';

    const embed = new EmbedBuilder()
    .setTitle('⚠ داعم ألغى البوست')
    .setDescription(`**العضو:** ${newMember}\n**الرول:** ${role || 'محذوف'}\n**الأعضاء:** ${JSON.parse(data.members).length}/3`)
    .setColor(0xFF0000)
    .setThumbnail(newMember.user.displayAvatarURL())
    .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`delete_role_${data.userId}`).setLabel('حذف الرول').setStyle(ButtonStyle.Danger).setEmoji('🗑'),
      new ButtonBuilder().setCustomId(`keep_role_${data.userId}`).setLabel('احتفاظ').setStyle(ButtonStyle.Success).setEmoji('✅')
    );

    const msg = await logChannel.send({ content: mentions, embeds: [embed], components: [row] });
    db.prepare('INSERT OR REPLACE INTO pending_boost_loss VALUES (?,?,?,?,?,?,?,?)')
    .run(newMember.id, data.roleId, newMember.guild.id, logChannel.id, msg.id, Date.now(), 0, null);

    await logAction(newMember.guild, `⚠ ${newMember.user.tag} فقد البوست`);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.guild) return;

  // ===== /ping =====
  if (interaction.isChatInputCommand() && interaction.commandName === 'ping') {
    const sent = await interaction.reply({ content: '...', fetchReply: true, ephemeral: true });
    const ping = sent.createdTimestamp - interaction.createdTimestamp;
    return interaction.editReply(`🏓 ${ping}ms | API: ${Math.round(client.ws.ping)}ms`);
  }

  // ===== /setup =====
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator) &&!isManager(interaction.user.id)) {
      return interaction.reply({ content: '❌ للإدارة فقط', ephemeral: true });
    }

    const embed = new EmbedBuilder().setTitle('يرجى تحديد نوع التعديل..').setColor(0x2B2D31);
    const menu = new StringSelectMenuBuilder()
    .setCustomId('admin_setup')
    .setPlaceholder('يرجى تحديد نوع التعديل..')
    .addOptions([
        { label: 'قائمة الرولات', value: 'list_roles', description: 'لعرض قائمة الرولات المضافه بالبوت.', emoji: '🗄' },
        { label: 'اضافة/ازالة مسؤول', value: 'toggle_manager', description: 'لتحديد مسؤول للرولات الخاصه', emoji: '👤' },
        { label: 'قائمة المسؤولين', value: 'list_managers', description: 'لعرض قائمة مسؤولين الرولات الخاصه.', emoji: '👥' },
        { label: 'لوق الرولات', value: 'set_log', description: 'لتحديد لوق الرولات الخاصه.', emoji: '📤' },
        { label: 'الرولات الجديده', value: 'set_new_roles', description: 'لتحديد شات معلومات الرولات الجديده.', emoji: '➕' },
        { label: 'رسالة التحكم بالرولات للاداره', value: 'send_admin_panel', description: 'لارسال رسالة التحكم بالقروبات للادارة.', emoji: '👤' },
        { label: 'رسالة التحكم بالرول', value: 'send_user_panel', description: 'لارسال رسالة التحكم بالرول الخاص من الزر.', emoji: '⚙' },
        { label: 'اضافة/ازالة شات مصرح له', value: 'toggle_allowed', description: 'لتحديد شات يمكن استعمال الامر به.', emoji: '✅' },
        { label: 'اضافة/ازالة شات محظور استخدام الامر', value: 'toggle_blocked', description: 'لتحديد شات لا يمكن استخدام الاوامر به.', emoji: '🚫' },
        { label: 'قائمة الشاتات', value: 'list_channels', description: 'لعرض قائمة الشاتات.', emoji: '📨' }
      ]);

    return interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
  }

  // ===== /roles =====
  if (interaction.isChatInputCommand() && interaction.commandName === 'roles') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌', ephemeral: true });
    }

    const embed = new EmbedBuilder().setDescription('للتحكم بالرول الخاص بك الضغط على الزر.').setColor(0x2B2D31);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_user_panel').setEmoji('⚙').setStyle(ButtonStyle.Secondary)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ تم إرسال اللوحة', ephemeral: true });
  }

  // ===== فتح لوحة الداعم =====
  if (interaction.isButton() && interaction.customId === 'open_user_panel') {
    const embed = new EmbedBuilder().setAuthor({ name: 'Roles.' }).setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('create_role').setLabel('انشاء رول').setStyle(ButtonStyle.Secondary).setEmoji('➕'),
      new ButtonBuilder().setCustomId('add_role_member').setLabel('اضافة عضو').setStyle(ButtonStyle.Secondary).setEmoji('📝')
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('remove_role_member').setLabel('ازالة عضو').setStyle(ButtonStyle.Secondary).setEmoji('➖'),
      new ButtonBuilder().setCustomId('delete_role').setLabel('حذف رول').setStyle(ButtonStyle.Secondary).setEmoji('🗑')
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('role_info').setLabel('معلومات رول').setStyle(ButtonStyle.Secondary).setEmoji('⚙')
    );

    return interaction.reply({ embeds: [embed], components: [row1, row2, row3], ephemeral: true });
  }

  // ===== باقي الكود كما هو =====
  if (interaction.isStringSelectMenu() && interaction.customId === 'admin_setup') {
    const value = interaction.values[0];
    await interaction.deferUpdate();

    if (value === 'list_roles') {
      const roles = db.prepare('SELECT * FROM roles').all();
      const text = roles.map(r => `<@&${r.roleId}> - <@${r.userId}>`).join('\n') || 'لا يوجد رولات';
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('قائمة الرولات').setDescription(text).setColor(0x2B2D31)], components: [] });
    }

    if (value === 'toggle_manager') {
      const modal = new ModalBuilder().setCustomId('toggle_manager').setTitle('اضافة/ازالة مسؤول');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('id').setLabel('منشن أو ID العضو').setStyle(TextInputStyle.Short).setRequired(true)
      ));
      return interaction.showModal(modal);
    }

    if (value === 'list_managers') {
      const managers = JSON.parse(getSetting('managers') || '[]');
      const text = managers.map(id => `<@${id}>`).join('\n') || 'لا يوجد مسؤولين';
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('قائمة المسؤولين').setDescription(text).setColor(0x2B2D31)], components: [] });
    }

    if (value === 'set_log') {
      setSetting('logChannel', interaction.channelId);
      return interaction.editReply({ content: '✅ تم تحديد هذا الروم كـ لوق للرولات', components: [] });
    }

    if (value === 'set_new_roles') {
      setSetting('newRolesChannel', interaction.channelId);
      return interaction.editReply({ content: '✅ تم تحديد هذا الروم لإشعارات الرولات الجديدة', components: [] });
    }

    if (value === 'send_user_panel') {
      const embed = new EmbedBuilder().setDescription('للتحكم بالرول الخاص بك الضغط على الزر.').setColor(0x2B2D31);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_user_panel').setEmoji('⚙').setStyle(ButtonStyle.Secondary)
      );
      await interaction.channel.send({ embeds: [embed], components: [row] });
      return interaction.editReply({ content: '✅ تم إرسال لوحة الداعمين', components: [] });
    }

    if (value === 'send_admin_panel') {
      return interaction.editReply({ content: '✅ استخدم /setup', components: [] });
    }

    if (value === 'toggle_allowed') {
      const modal = new ModalBuilder().setCustomId('toggle_allowed').setTitle('شات مصرح');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('id').setLabel('ID الروم').setStyle(TextInputStyle.Short).setRequired(true)
      ));
      return interaction.showModal(modal);
    }

    if (value === 'toggle_blocked') {
      const modal = new ModalBuilder().setCustomId('toggle_blocked').setTitle('شات محظور');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('id').setLabel('ID الروم').setStyle(TextInputStyle.Short).setRequired(true)
      ));
      return interaction.showModal(modal);
    }

    if (value === 'list_channels') {
      const allowed = JSON.parse(getSetting('allowedChannels') || '[]');
      const blocked = JSON.parse(getSetting('blockedChannels') || '[]');
      const text = `**المصرح بها:**\n${allowed.map(id => `<#${id}>`).join('\n') || 'لا يوجد'}\n\n**المحظورة:**\n${blocked.map(id => `<#${id}>`).join('\n') || 'لا يوجد'}`;
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('قائمة الشاتات').setDescription(text).setColor(0x2B2D31)], components: [] });
    }
  }

  // ===== باقي المودالات والأزرار (نفس كودك) =====
  if (interaction.isModalSubmit() && interaction.customId === 'toggle_manager') {
    const id = interaction.fields.getTextInputValue('id').replace(/[<@!>]/g, '');
    const managers = JSON.parse(getSetting('managers') || '[]');
    const index = managers.indexOf(id);
    if (index > -1) managers.splice(index, 1); else managers.push(id);
    setSetting('managers', JSON.stringify(managers));
    return interaction.reply({ content: index > -1? '✅ تمت إزالة المسؤول' : '✅ تمت إضافة المسؤول', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'toggle_allowed') {
    const id = interaction.fields.getTextInputValue('id');
    const allowed = JSON.parse(getSetting('allowedChannels') || '[]');
    const index = allowed.indexOf(id);
    if (index > -1) allowed.splice(index, 1); else allowed.push(id);
    setSetting('allowedChannels', JSON.stringify(allowed));
    return interaction.reply({ content: '✅ تم التحديث', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'toggle_blocked') {
    const id = interaction.fields.getTextInputValue('id');
    const blocked = JSON.parse(getSetting('blockedChannels') || '[]');
    const index = blocked.indexOf(id);
    if (index > -1) blocked.splice(index, 1); else blocked.push(id);
    setSetting('blockedChannels', JSON.stringify(blocked));
    return interaction.reply({ content: '✅ تم التحديث', ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'create_role') {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const allowed = JSON.parse(getSetting('allowedChannels') || '[]');
    const blocked = JSON.parse(getSetting('blockedChannels') || '[]');
    if (allowed.length > 0 &&!allowed.includes(interaction.channelId)) return interaction.reply({ content: '❌ هذا الروم غير مصرح', ephemeral: true });
    if (blocked.includes(interaction.channelId)) return interaction.reply({ content: '❌ هذا الروم محظور', ephemeral: true });
    if (!isBooster(member)) return interaction.reply({ content: '❌ يجب أن تكون بوستر', ephemeral: true });
    if (db.prepare('SELECT * FROM roles WHERE userId =?').get(interaction.user.id)) return interaction.reply({ content: '❌ لديك رول بالفعل', ephemeral: true });

    const modal = new ModalBuilder().setCustomId('role_create').setTitle('انشاء رول');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('اسم الرول').setStyle(TextInputStyle.Short).setMaxLength(32).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('اللون (مثال: #FF0000 أو #FF0000,#00FF00)').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('icon').setLabel('الشعار (رابط أو إيموجي)').setStyle(TextInputStyle.Short).setRequired(false))
    );
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'role_create') {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.fields.getTextInputValue('name');
    const colors = interaction.fields.getTextInputValue('color').split(',').map(s => s.trim());
    const color1 = colors[0];
    const color2 = colors[1] || null;
    const icon = parseIcon(interaction.fields.getTextInputValue('icon'));
    try {
      const role = await interaction.guild.roles.create({ name, color: color1, icon, reason: `رول خاص لـ ${interaction.user.tag}` });
      await interaction.member.roles.add(role);
      db.prepare('INSERT INTO roles VALUES (?,?,?,?,?,?,?,?,?)').run(interaction.user.id, role.id, name, color1, color2, icon, JSON.stringify([interaction.user.id]), Date.now(), interaction.user.id);
      const newChannel = getSetting('newRolesChannel');
      if (newChannel) { const ch = await interaction.guild.channels.fetch(newChannel).catch(() => null); if (ch) ch.send(`✨ رول جديد: ${role} بواسطة ${interaction.user}`); }
      await logAction(interaction.guild, `✨ ${interaction.user} أنشأ رول ${role}`);
      await interaction.editReply(`✅ تم إنشاء رولك ${role}`);
    } catch (error) { await interaction.editReply(`❌ خطأ: ${error.message}`); }
  }

  // باقي الأزرار (إضافة عضو، إزالة، حذف، معلومات) - نفس كودك الأصلي
  if (interaction.isButton() && interaction.customId === 'add_role_member') {
    const data = db.prepare('SELECT * FROM roles WHERE userId =?').get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ ليس لديك رول', ephemeral: true });
    const members = JSON.parse(data.members);
    if (members.length >= 3) return interaction.reply({ content: '❌ وصلت للحد الأقصى (3 أعضاء)', ephemeral: true });
    const modal = new ModalBuilder().setCustomId('add_member').setTitle('اضافة عضو');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('منشن العضو أو ID').setStyle(TextInputStyle.Short).setRequired(true)));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'add_member') {
    await interaction.deferReply({ ephemeral: true });
    const id = interaction.fields.getTextInputValue('id').replace(/[<@!>]/g, '');
    const data = db.prepare('SELECT * FROM roles WHERE userId =?').get(interaction.user.id);
    if (!data) return interaction.editReply('❌');
    const role = await interaction.guild.roles.fetch(data.roleId);
    const member = await interaction.guild.members.fetch(id).catch(() => null);
    if (!member) return interaction.editReply('❌ العضو غير موجود');
    const members = JSON.parse(data.members);
    if (members.includes(id)) return interaction.editReply('❌ العضو مضاف مسبقاً');
    members.push(id);
    await member.roles.add(role);
    db.prepare('UPDATE roles SET members =? WHERE userId =?').run(JSON.stringify(members), interaction.user.id);
    await logAction(interaction.guild, `➕ ${interaction.user} أضاف ${member} إلى روله`);
    await interaction.editReply(`✅ تم إضافة ${member} إلى رولك`);
  }

  if (interaction.isButton() && interaction.customId === 'remove_role_member') {
    const data = db.prepare('SELECT * FROM roles WHERE userId =?').get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ ليس لديك رول', ephemeral: true });
    const members = JSON.parse(data.members).filter(id => id!== interaction.user.id);
    if (members.length === 0) return interaction.reply({ content: '❌ لا يوجد أعضاء لإزالتهم', ephemeral: true });
    const options = await Promise.all(members.map(async id => { const member = await interaction.guild.members.fetch(id).catch(() => null); return { label: member? member.user.tag : id, value: id }; }));
    const menu = new StringSelectMenuBuilder().setCustomId('remove_member_select').setPlaceholder('اختر عضو لإزالته').addOptions(options);
    return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'remove_member_select') {
    await interaction.deferUpdate();
    const memberId = interaction.values[0];
    const data = db.prepare('SELECT * FROM roles WHERE userId =?').get(interaction.user.id);
    const role = await interaction.guild.roles.fetch(data.roleId);
    const member = await interaction.guild.members.fetch(memberId).catch(() => null);
    if (member) await member.roles.remove(role);
    const members = JSON.parse(data.members).filter(id => id!== memberId);
    db.prepare('UPDATE roles SET members =? WHERE userId =?').run(JSON.stringify(members), interaction.user.id);
    await logAction(interaction.guild, `➖ ${interaction.user} أزال ${member || memberId} من روله`);
    await interaction.editReply({ content: `✅ تمت إزالة ${member || 'العضو'}`, components: [] });
  }

  if (interaction.isButton() && interaction.customId === 'delete_role') {
    const data = db.prepare('SELECT * FROM roles WHERE userId =?').get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ ليس لديك رول', ephemeral: true });
    const role = await interaction.guild.roles.fetch(data.roleId).catch(() => null);
    if (role) await role.delete('حذف بواسطة المالك');
    db.prepare('DELETE FROM roles WHERE userId =?').run(interaction.user.id);
    await logAction(interaction.guild, `🗑 ${interaction.user} حذف روله`);
    return interaction.reply({ content: '✅ تم حذف رولك', ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'role_info') {
    const data = db.prepare('SELECT * FROM roles WHERE userId =?').get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ ليس لديك رول', ephemeral: true });
    const role = await interaction.guild.roles.fetch(data.roleId);
    const members = JSON.parse(data.members);
    const membersList = members.map(id => `<@${id}>`).join('\n');
    const embed = new EmbedBuilder().setTitle(`معلومات رول: ${role.name}`).setColor(data.color).addFields({ name: 'الاسم', value: role.name, inline: true }, { name: 'اللون', value: data.color2? `${data.color} → ${data.color2}` : data.color, inline: true }, { name: 'الأعضاء', value: `${members.length}/3\n${membersList}`, inline: false }, { name: 'تاريخ الإنشاء', value: `<t:${Math.floor(data.createdAt / 1000)}:F>`, inline: false });
    if (data.icon) embed.setThumbnail(data.icon);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId.startsWith('delete_role_')) {
    if (!isManager(interaction.user.id) &&!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌', ephemeral: true });
    const userId = interaction.customId.split('_')[2];
    const data = db.prepare('SELECT * FROM roles WHERE userId =?').get(userId);
    if (data) { const role = await interaction.guild.roles.fetch(data.roleId).catch(() => null); if (role) await role.delete('فقدان بوست'); const members = JSON.parse(data.members); for (const id of members) { const m = await interaction.guild.members.fetch(id).catch(() => null); if (m && role) await m.roles.remove(role).catch(() => {}); } db.prepare('DELETE FROM roles WHERE userId =?').run(userId); }
    db.prepare('UPDATE pending_boost_loss SET action =? WHERE userId =?').run('deleted', userId);
    await interaction.update({ content: `✅ تم الحذف بواسطة ${interaction.user}`, embeds: [], components: [] });
    await logAction(interaction.guild, `🗑 **حذف رول**\nالعضو: <@${userId}>\nبواسطة: ${interaction.user}`);
  }

  if (interaction.isButton() && interaction.customId.startsWith('keep_role_')) {
    if (!isManager(interaction.user.id) &&!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌', ephemeral: true });
    const userId = interaction.customId.split('_')[2];
    db.prepare('UPDATE pending_boost_loss SET action =? WHERE userId =?').run('kept', userId);
    await interaction.update({ content: `✅ تم الاحتفاظ بواسطة ${interaction.user}`, embeds: [], components: [] });
    await logAction(interaction.guild, `✅ **احتفاظ برول**\nالعضو: <@${userId}>\nبواسطة: ${interaction.user}`);
  }
});

client.login(process.env.TOKEN);
