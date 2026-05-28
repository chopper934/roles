import {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
  SlashCommandBuilder, PermissionFlagsBits, REST, Routes, ActivityType
} from "discord.js";
import fs from 'fs';
import http from 'http';
import Database from "better-sqlite3";

// === Railway ===
http.createServer((_,r)=>r.end('OK')).listen(process.env.PORT||3000);
if(!fs.existsSync('/data')) fs.mkdirSync('/data',{recursive:true});
const db = new Database('/data/roles.db');

db.exec(`CREATE TABLE IF NOT EXISTS roles (userId TEXT PRIMARY KEY, roleId TEXT, name TEXT, color2 TEXT, icon TEXT, members TEXT, createdAt INTEGER, createdBy TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS pending_boost_loss (userId TEXT PRIMARY KEY, roleId TEXT, guildId TEXT, channelId TEXT, messageId TEXT, createdAt INTEGER, reminded INTEGER DEFAULT 0, action TEXT)`);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const get = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const set = (k,v) => db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(k,v);
const isManager = id => JSON.parse(get('managers')||'[]').includes(id);
const isBooster = m => m.premiumSince || isManager(m.id);
const parseIcon = i => { if(!i) return null; if(i.startsWith('http')) return i; const m=i.match(/<a?:\w+:(\d+)>/); if(m) return `https://cdn.discordapp.com/emojis/${m[1]}.webp`; if(/^\d{17,20}$/.test(i)) return `https://cdn.discordapp.com/emojis/${i}.webp`; return null; };

const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('لوحة تحكم البوت'),
  new SlashCommandBuilder().setName('roles').setDescription('إرسال لوحة البوسترز'),
  new SlashCommandBuilder().setName('ping').setDescription('فحص البوت')
].map(c=>c.toJSON());

client.once('ready', async ()=>{
  console.log(`✅ ${client.user.tag}`);
  client.user.setPresence({ activities:[{name:'Dev By Cho',type:ActivityType.Watching}], status:'online' });
  await new REST({version:'10'}).setToken(process.env.TOKEN).put(Routes.applicationCommands(client.user.id),{body:commands});
});

// === بناء لوحة البوسترز (تقدر تعدلها من /setup) ===
function buildBoosterPanel(){
  const title = get('panel_title') || 'لوحة التحكم في الرتبة الخاصة';
  const desc = get('panel_desc') || 'مرحبا بك في قسم الخصائص\n\nهنا يمكنك التحكم في رتبتك الخاصة وتعديلها لتظهر لك حسب خياراتك';
  const color = get('panel_color') || '#2B2D31';
  const image = get('panel_image');
  const thumb = get('panel_thumb');

  const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
  if(image) embed.setImage(image);
  if(thumb) embed.setThumbnail(thumb);

  const menu = new StringSelectMenuBuilder()
   .setCustomId('booster_menu')
   .setPlaceholder('اختر إجراء رتبتك الخاصة...')
   .addOptions([
      {label:'إنشاء رتبتي الخاصة', value:'create', emoji:'⭐'},
      {label:'تغيير اسم الرتبة', value:'rename', emoji:'⭐'},
      {label:'مشاركة الرتبة مع عضو', value:'share', emoji:'⭐'},
      {label:'إزالة الرتبة من العضو المشارك', value:'unshare', emoji:'⭐'},
      {label:'تغيير لون الرتبة', value:'color', emoji:'⭐'},
      {label:'تغيير أيقونة الرتبة', value:'icon', emoji:'⭐'},
      {label:'حذف الرتبة', value:'delete', emoji:'⭐'}
    ]);
  return { embed, row: new ActionRowBuilder().addComponents(menu) };
}

client.on('interactionCreate', async i=>{
  if(!i.guild) return;
  try{

  // /ping
  if(i.isChatInputCommand() && i.commandName==='ping'){
    const s=await i.reply({content:'...',fetchReply:true,ephemeral:true});
    return i.editReply(`🏓 ${Date.now()-s.createdTimestamp}ms`);
  }

  // /setup
  if(i.isChatInputCommand() && i.commandName==='setup'){
    if(!i.memberPermissions.has(PermissionFlagsBits.Administrator) &&!isManager(i.user.id)) return i.reply({content:'❌',ephemeral:true});
    const e=new EmbedBuilder().setTitle('لوحة تحكم المالك').setColor(0x2B2D31);
    const m=new StringSelectMenuBuilder().setCustomId('owner_setup').setPlaceholder('اختر...')
     .addOptions([
        {label:'تخصيص لوحة البوسترز', value:'custom_panel', description:'غير العنوان والوصف واللون والصورة', emoji:'🎨'},
        {label:'تحديد لوق الرولات', value:'set_log', emoji:'📤'},
        {label:'إضافة/إزالة مسؤول', value:'manager', emoji:'👤'},
        {label:'قائمة الرولات', value:'list', emoji:'🗄'}
      ]);
    return i.reply({embeds:[e],components:[new ActionRowBuilder().addComponents(m)],ephemeral:true});
  }

  if(i.isStringSelectMenu() && i.customId==='owner_setup'){
    const v=i.values[0];
    if(v==='custom_panel'){
      const modal=new ModalBuilder().setCustomId('panel_edit').setTitle('تخصيص اللوحة');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('العنوان').setStyle(TextInputStyle.Short).setValue(get('panel_title')||'')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('الوصف').setStyle(TextInputStyle.Paragraph).setValue(get('panel_desc')||'')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('اللون HEX').setStyle(TextInputStyle.Short).setValue(get('panel_color')||'#2B2D31')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('رابط الصورة الكبيرة').setStyle(TextInputStyle.Short).setValue(get('panel_image')||'').setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('thumb').setLabel('رابط الصورة المصغرة').setStyle(TextInputStyle.Short).setValue(get('panel_thumb')||'').setRequired(false))
      );
      return i.showModal(modal);
    }
    if(v==='set_log'){ set('logChannel',i.channelId); return i.reply({content:'✅ تم',ephemeral:true}); }
    if(v==='manager'){ /* نفس كودك */ }
    if(v==='list'){ const r=db.prepare('SELECT * FROM roles').all(); return i.reply({content:r.map(x=>`<@&${x.roleId}>`).join('\n')||'لا يوجد',ephemeral:true}); }
  }

  if(i.isModalSubmit() && i.customId==='panel_edit'){
    set('panel_title', i.fields.getTextInputValue('title'));
    set('panel_desc', i.fields.getTextInputValue('desc'));
    set('panel_color', i.fields.getTextInputValue('color'));
    set('panel_image', i.fields.getTextInputValue('image'));
    set('panel_thumb', i.fields.getTextInputValue('thumb'));
    return i.reply({content:'✅ تم حفظ تصميم اللوحة',ephemeral:true});
  }

  // /roles
  if(i.isChatInputCommand() && i.commandName==='roles'){
    await i.deferReply({ephemeral:true});
    const p=buildBoosterPanel();
    await i.channel.send({embeds:[p.embed],components:[p.row]});
    return i.editReply('✅ تم إرسال لوحة البوسترز');
  }

  // منيو البوسترز
  if(i.isStringSelectMenu() && i.customId==='booster_menu'){
    await i.deferReply({ephemeral:true});
    const action=i.values[0];
    const data=db.prepare('SELECT * FROM roles WHERE userId=?').get(i.user.id);
    const member=await i.guild.members.fetch(i.user.id);

    if(!isBooster(member)) return i.editReply('❌ لازم تكون بوستر');

    if(action==='create'){
      if(data) return i.editReply('❌ عندك رتبة already');
      const m=new ModalBuilder().setCustomId('create_role').setTitle('إنشاء رتبتي');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('اسم الرتبة').setStyle(TextInputStyle.Short).setRequired(true)));
      return i.showModal(m);
    }
    if(!data) return i.editReply('❌ ما عندك رتبة');

    if(action==='rename'){
      const m=new ModalBuilder().setCustomId('rename_role').setTitle('تغيير الاسم');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('الاسم الجديد').setStyle(TextInputStyle.Short).setValue(data.name).setRequired(true)));
      return i.showModal(m);
    }
    if(action==='share'){
      const m=new ModalBuilder().setCustomId('share_role').setTitle('مشاركة الرتبة');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('ID العضو').setStyle(TextInputStyle.Short).setRequired(true)));
      return i.showModal(m);
    }
    if(action==='unshare'){
      const members=JSON.parse(data.members).filter(id=>id!==i.user.id);
      if(!members.length) return i.editReply('❌ ما فيه أحد');
      const mem=await i.guild.members.fetch(members[0]);
      await mem.roles.remove(data.roleId);
      db.prepare('UPDATE roles SET members=? WHERE userId=?').run(JSON.stringify([i.user.id]),i.user.id);
      return i.editReply('✅ تمت الإزالة');
    }
    if(action==='color'){
      const m=new ModalBuilder().setCustomId('color_role').setTitle('تغيير اللون');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('HEX مثل #ff0000').setStyle(TextInputStyle.Short).setValue(data.color).setRequired(true)));
      return i.showModal(m);
    }
    if(action==='icon'){
      const m=new ModalBuilder().setCustomId('icon_role').setTitle('تغيير الأيقونة');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('icon').setLabel('رابط أو إيموجي').setStyle(TextInputStyle.Short).setRequired(false)));
      return i.showModal(m);
    }
    if(action==='delete'){
      const role=await i.guild.roles.fetch(data.roleId).catch(()=>null);
      if(role) await role.delete();
      db.prepare('DELETE FROM roles WHERE userId=?').run(i.user.id);
      return i.editReply('✅ تم حذف رتبتك');
    }
  }

  // معالجة المودالات
  if(i.isModalSubmit() && i.customId==='create_role'){
    await i.deferReply({ephemeral:true});
    const name=i.fields.getTextInputValue('name');
    const role=await i.guild.roles.create({name, reason:'رتبة بوستر'});
    await i.member.roles.add(role);
    db.prepare('INSERT INTO roles VALUES (?,?,?,?,?,?,?,?,?)').run(i.user.id,role.id,name,'#2B2D31',null,null,JSON.stringify([i.user.id]),Date.now(),i.user.id);
    return i.editReply(`✅ تم إنشاء ${role}`);
  }
  if(i.isModalSubmit() && i.customId==='rename_role'){
    await i.deferReply({ephemeral:true});
    const data=db.prepare('SELECT * FROM roles WHERE userId=?').get(i.user.id);
    const role=await i.guild.roles.fetch(data.roleId);
    await role.setName(i.fields.getTextInputValue('name'));
    db.prepare('UPDATE roles SET name=? WHERE userId=?').run(role.name,i.user.id);
    return i.editReply('✅ تم تغيير الاسم');
  }
  if(i.isModalSubmit() && i.customId==='color_role'){
    await i.deferReply({ephemeral:true});
    const data=db.prepare('SELECT * FROM roles WHERE userId=?').get(i.user.id);
    const role=await i.guild.roles.fetch(data.roleId);
    await role.setColor(i.fields.getTextInputValue('color'));
    db.prepare('UPDATE roles SET color=? WHERE userId=?').run(i.fields.getTextInputValue('color'),i.user.id);
    return i.editReply('✅ تم تغيير اللون');
  }
  if(i.isModalSubmit() && i.customId==='icon_role'){
    await i.deferReply({ephemeral:true});
    const data=db.prepare('SELECT * FROM roles WHERE userId=?').get(i.user.id);
    const role=await i.guild.roles.fetch(data.roleId);
    await role.setIcon(parseIcon(i.fields.getTextInputValue('icon')));
    return i.editReply('✅ تم تغيير الأيقونة');
  }
  if(i.isModalSubmit() && i.customId==='share_role'){
    await i.deferReply({ephemeral:true});
    const data=db.prepare('SELECT * FROM roles WHERE userId=?').get(i.user.id);
    const mem=await i.guild.members.fetch(i.fields.getTextInputValue('id')).catch(()=>null);
    if(!mem) return i.editReply('❌');
    await mem.roles.add(data.roleId);
    const members=JSON.parse(data.members); members.push(mem.id);
    db.prepare('UPDATE roles SET members=? WHERE userId=?').run(JSON.stringify(members),i.user.id);
    return i.editReply(`✅ تمت المشاركة مع ${mem.user.tag}`);
  }

  }catch(e){ console.error(e); }
});

client.login(process.env.TOKEN);
