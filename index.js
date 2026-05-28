// ============================================
// Roles Bot - Full Version by Cho
// مع إصلاح Railway + حفظ دائم + الحالة
// ============================================
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  ActivityType,
  ChannelType
} from "discord.js";
import fs from 'fs';
import Database from "better-sqlite3";
import http from 'http';

// ===== 1. حل مشكلة كراش Railway =====
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Roles Bot is Alive');
}).listen(process.env.PORT || 3000, () => {
  console.log(`🌐 HTTP Server running on port ${process.env.PORT || 3000}`);
});

// ===== 2. قاعدة البيانات الدائمة =====
const DATA_DIR = '/data';
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('📁 تم إنشاء مجلد /data');
}

const db = new Database(`${DATA_DIR}/roles.db`);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  emoji TEXT,
  created_by TEXT,
  created_at INTEGER,
  PRIMARY KEY (guild_id, role_id)
);

CREATE TABLE IF NOT EXISTS config (
  guild_id TEXT PRIMARY KEY,
  log_channel TEXT,
  panel_channel TEXT,
  panel_message TEXT,
  admin_role TEXT,
  max_roles INTEGER DEFAULT 5
);

CREATE TABLE IF NOT EXISTS user_roles (
  guild_id TEXT,
  user_id TEXT,
  role_id TEXT,
  assigned_at INTEGER,
  PRIMARY KEY (guild_id, user_id, role_id)
);
`);

console.log('💾 Database connected at /data/roles.db');

// ===== 3. إعداد البوت =====
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error('❌ TOKEN غير موجود في Environment Variables');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

// ===== 4. الأوامر =====
const commands = [
  new SlashCommandBuilder()
   .setName('roles')
   .setDescription('إرسال لوحة الرولات التفاعلية')
   .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
   .setName('setup')
   .setDescription('إعداد نظام الرولات')
   .addChannelOption(opt =>
      opt.setName('log_channel')
       .setDescription('روم سجل الرولات')
       .addChannelTypes(ChannelType.GuildText)
       .setRequired(true)
    )
   .addIntegerOption(opt =>
      opt.setName('max_roles')
       .setDescription('الحد الأقصى للرولات لكل عضو (افتراضي 5)')
       .setMinValue(1)
       .setMaxValue(20)
    )
   .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
   .setName('addrole')
   .setDescription('إضافة رول للوحة بسرعة')
   .addRoleOption(opt => opt.setName('role').setDescription('الرول').setRequired(true))
   .addStringOption(opt => opt.setName('label').setDescription('الاسم المعروض').setRequired(true))
   .addStringOption(opt => opt.setName('emoji').setDescription('إيموجي').setRequired(false))
   .addStringOption(opt => opt.setName('description').setDescription('وصف').setRequired(false))
   .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
   .setName('removerole')
   .setDescription('حذف رول من اللوحة')
   .addRoleOption(opt => opt.setName('role').setDescription('الرول').setRequired(true))
   .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
   .setName('roles-info')
   .setDescription('معلومات عن الرولات')
].map(cmd => cmd.toJSON());

// ===== 5. دوال مساعدة =====
function getConfig(guildId) {
  return db.prepare('SELECT * FROM config WHERE guild_id =?').get(guildId) || {};
}

function getRoles(guildId) {
  return db.prepare('SELECT * FROM roles WHERE guild_id =? ORDER BY label').all(guildId);
}

function buildPanelEmbed(guild, roles) {
  const embed = new EmbedBuilder()
   .setTitle('🎭 نظام الرولات التفاعلي')
   .setColor(0x5865F2)
   .setThumbnail(guild.iconURL({ dynamic: true }))
   .setTimestamp();

  if (roles.length === 0) {
    embed.setDescription('> ⚠️ لا توجد رولات مضافة حالياً\n> استخدم `/addrole` لإضافة رول');
  } else {
    embed.setDescription(
      `> اختر الرولات التي تريدها من القائمة أدناه\n` +
      `> عدد الرولات المتاحة: **${roles.length}**\n\n` +
      roles.map(r => `${r.emoji || '▫️'} <@&${r.role_id}> - ${r.label}${r.description? `\n> ${r.description}` : ''}`).join('\n\n')
    );
  }

  embed.setFooter({ text: `Dev By Cho | ${guild.name}`, iconURL: client.user.displayAvatarURL() });
  return embed;
}

async function logAction(guildId, action, user, roleId) {
  const config = getConfig(guildId);
  if (!config.log_channel) return;

  try {
    const channel = await client.channels.fetch(config.log_channel);
    if (!channel) return;

    const embed = new EmbedBuilder()
     .setColor(action === 'ADD'? 0x57F287 : 0xED4245)
     .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
     .setDescription(`${action === 'ADD'? '➕ أخذ' : '➖ شال'} ${user} الرول <@&${roleId}>`)
     .setTimestamp();

    channel.send({ embeds: [embed] });
  } catch (e) {}
}

// ===== 6. حدث الجاهزية =====
client.once('clientReady', async () => {
  console.log(`\n✅ ${client.user.tag} جاهز`);
  console.log(`📊 السيرفرات: ${client.guilds.cache.size}`);

  // الحالة المطلوبة
  client.user.setPresence({
    activities: [{ name: 'Dev By Cho', type: ActivityType.Watching }],
    status: 'online'
  });

  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ تم تسجيل جميع الأوامر');
  } catch (error) {
    console.error('❌ خطأ في تسجيل الأوامر:', error);
  }
});

// ===== 7. التفاعلات =====
client.on('interactionCreate', async (interaction) => {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    // --- /setup ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
      const logChannel = interaction.options.getChannel('log_channel');
      const maxRoles = interaction.options.getInteger('max_roles') || 5;

      db.prepare(`
        INSERT INTO config (guild_id, log_channel, max_roles)
        VALUES (?,?,?)
        ON CONFLICT(guild_id) DO UPDATE SET log_channel=excluded.log_channel, max_roles=excluded.max_roles
      `).run(guildId, logChannel.id, maxRoles);

      const embed = new EmbedBuilder()
       .setTitle('⚙️ تم الإعداد بنجاح')
       .setColor(0x57F287)
       .addFields(
          { name: '📝 روم اللوق', value: `${logChannel}`, inline: true },
          { name: '🔢 الحد الأقصى', value: `${maxRoles} رولات`, inline: true }
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- /addrole ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'addrole') {
      const role = interaction.options.getRole('role');
      const label = interaction.options.getString('label');
      const emoji = interaction.options.getString('emoji');
      const description = interaction.options.getString('description');

      db.prepare(`
        INSERT OR REPLACE INTO roles (guild_id, role_id, label, description, emoji, created_by, created_at)
        VALUES (?,?,?,?,?,?,?)
      `).run(guildId, role.id, label, description, emoji, interaction.user.id, Date.now());

      return interaction.reply({ content: `✅ تم إضافة ${role} باسم **${label}**`, ephemeral: true });
    }

    // --- /removerole ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'removerole') {
      const role = interaction.options.getRole('role');
      db.prepare('DELETE FROM roles WHERE guild_id =? AND role_id =?').run(guildId, role.id);
      return interaction.reply({ content: `✅ تم حذف ${role} من اللوحة`, ephemeral: true });
    }

    // --- /roles ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'roles') {
      const roles = getRoles(guildId);
      const embed = buildPanelEmbed(interaction.guild, roles);

      const selectMenu = new StringSelectMenuBuilder()
       .setCustomId('role_select')
       .setPlaceholder('🎭 اختر رول لإضافته أو إزالته')
       .setMinValues(1)
       .setMaxValues(Math.min(roles.length, 5))
       .addOptions(
          roles.length > 0
           ? roles.slice(0, 25).map(r => ({
                label: r.label.substring(0, 100),
                value: r.role_id,
                description: r.description?.substring(0, 100),
                emoji: r.emoji
              }))
            : [{ label: 'لا توجد رولات', value: 'none', default: true }]
        )
       .setDisabled(roles.length === 0);

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('add_role_modal').setLabel('إضافة رول').setStyle(ButtonStyle.Success).setEmoji('➕'),
        new ButtonBuilder().setCustomId('edit_panel').setLabel('تعديل').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
        new ButtonBuilder().setCustomId('refresh_panel').setLabel('تحديث').setStyle(ButtonStyle.Secondary).setEmoji('🔄')
      );

      const reply = await interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(selectMenu), buttons],
        fetchReply: true
      });

      db.prepare('UPDATE config SET panel_channel =?, panel_message =? WHERE guild_id =?')
       .run(interaction.channelId, reply.id, guildId);
      return;
    }

    // --- /roles-info ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'roles-info') {
      const roles = getRoles(guildId);
      const config = getConfig(guildId);
      const totalAssignments = db.prepare('SELECT COUNT(*) as c FROM user_roles WHERE guild_id =?').get(guildId).c;

      const embed = new EmbedBuilder()
       .setTitle('📊 إحصائيات الرولات')
       .setColor(0x5865F2)
       .addFields(
          { name: 'الرولات المتاحة', value: `${roles.length}`, inline: true },
          { name: 'إجمالي التعيينات', value: `${totalAssignments}`, inline: true },
          { name: 'الحد الأقصى', value: `${config.max_roles || 5}`, inline: true }
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- اختيار رول ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'role_select') {
      await interaction.deferReply({ ephemeral: true });
      const config = getConfig(guildId);
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const results = [];

      for (const roleId of interaction.values) {
        const hasRole = member.roles.cache.has(roleId);
        const userRoleCount = member.roles.cache.filter(r => getRoles(guildId).some(gr => gr.role_id === r.id)).size;

        if (!hasRole && userRoleCount >= (config.max_roles || 5)) {
          results.push(`❌ وصلت للحد الأقصى`);
          continue;
        }

        if (hasRole) {
          await member.roles.remove(roleId);
          db.prepare('DELETE FROM user_roles WHERE guild_id=? AND user_id=? AND role_id=?').run(guildId, member.id, roleId);
          await logAction(guildId, 'REMOVE', interaction.user, roleId);
          results.push(`➖ <@&${roleId}>`);
        } else {
          await member.roles.add(roleId);
          db.prepare('INSERT OR REPLACE INTO user_roles VALUES (?,?,?,?)').run(guildId, member.id, roleId, Date.now());
          await logAction(guildId, 'ADD', interaction.user, roleId);
          results.push(`➕ <@&${roleId}>`);
        }
      }

      return interaction.editReply({ content: results.join('\n') });
    }

    // --- أزرار الإدارة ---
    if (interaction.isButton() && interaction.customId === 'add_role_modal') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: '❌ ما عندك صلاحية', ephemeral: true });
      }

      const modal = new ModalBuilder().setCustomId('add_role_full').setTitle('إضافة رول جديد');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('role_id').setLabel('ID الرول').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('الاسم المعروض').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('إيموجي').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('الوصف').setStyle(TextInputStyle.Paragraph).setRequired(false))
      );
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'add_role_full') {
      const roleId = interaction.fields.getTextInputValue('role_id').replace(/[<@&>]/g, '');
      const label = interaction.fields.getTextInputValue('label');
      const emoji = interaction.fields.getTextInputValue('emoji');
      const desc = interaction.fields.getTextInputValue('desc');

      db.prepare('INSERT OR REPLACE INTO roles VALUES (?,?,?,?,?,?,?)')
       .run(guildId, roleId, label, desc, emoji, interaction.user.id, Date.now());

      await interaction.reply({ content: `✅ تم إضافة <@&${roleId}>`, ephemeral: true });

      // تحديث اللوحة
      const config = getConfig(guildId);
      if (config.panel_channel && config.panel_message) {
        try {
          const ch = await client.channels.fetch(config.panel_channel);
          const msg = await ch.messages.fetch(config.panel_message);
          const roles = getRoles(guildId);
          await msg.edit({ embeds: [buildPanelEmbed(interaction.guild, roles)] });
        } catch {}
      }
    }

    if (interaction.isButton() && interaction.customId === 'refresh_panel') {
      const roles = getRoles(guildId);
      await interaction.update({ embeds: [buildPanelEmbed(interaction.guild, roles)] });
    }

    if (interaction.isButton() && interaction.customId === 'edit_panel') {
      return interaction.reply({ content: 'استخدم `/addrole` و `/removerole` للتعديل', ephemeral: true });
    }

  } catch (error) {
    console.error('Interaction Error:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: '❌ حدث خطأ' }).catch(()=>{});
    } else {
      await interaction.reply({ content: '❌ حدث خطأ', ephemeral: true }).catch(()=>{});
    }
  }
});

// ===== 8. تسجيل الدخول =====
client.login(TOKEN);

process.on('unhandledRejection', err => console.error('Unhandled:', err));
process.on('uncaughtException', err => console.error('Uncaught:', err));

console.log('🚀 Starting Roles Bot...');
