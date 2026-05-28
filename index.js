import {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
  SlashCommandBuilder, PermissionFlagsBits, REST, Routes, ActivityType
} from "discord.js";
import fs from 'fs';
import http from 'http';
import Database from "better-sqlite3";

// === Railway keep alive ===
http.createServer((_,r)=>r.end('OK')).listen(process.env.PORT||3000);

// === قاعدة بيانات دائمة ===
if(!fs.existsSync('/data')) fs.mkdirSync('/data',{recursive:true});
const db = new Database('/data/roles.db');

db.exec(`CREATE TABLE IF NOT EXISTS roles (userId TEXT PRIMARY KEY, roleId TEXT, name TEXT, color TEXT, color2 TEXT, icon TEXT, members TEXT, createdAt INTEGER, createdBy TEXT)`);
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

// === بناء لوحة البوسترز ===
function buildBoosterPanel(){
  const title = get('panel_title') || 'لوحة التحكم في الرول الخاص';
  const desc = get('panel_desc') || 'مرحبا بك في قسم الخصائص\n\nهنا يمكنك التحكم في رولك الخاص';
  const color = get('panel_color') || '#2B2D31';
  const image = get('panel_image');
  const thumb = get('panel_thumb');
  const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
  if(image) embed.setImage(image);
  if(thumb) embed.setThumbnail(thumb);
  const menu = new StringSelectMenuBuilder().setCustomId('booster_menu').setPlaceholder('اختر إجراء رولك الخاص...')
    .addOptions([
      {label:'إنشاء رولي الخاص', value:'create', emoji:'➕'},
      {label:'تغيير اسم الرول', value:'rename', emoji:'✏️'},
      {label:'مشاركة الرول مع عضو', value:'share', emoji:'👥'},
      {label:'إزالة الرول من العضو', value:'unshare', emoji:'➖'},
      {label:'تغيير لون الرول', value:'color', emoji:'🎨'},
      {label:'تغيير أيقونة الرول', value:'icon', emoji:'🖼️'},
      {label:'حذف الرول', value:'delete', emoji:'🗑️'}
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

  // /setup - المسؤول والإدارة
  if(i.isChatInputCommand() && i.commandName==='setup'){
    if(!i.memberPermissions.has(PermissionFlagsBits.Administrator) && !isManager(i.user.id)) return i.reply({content:'❌',ephemeral:true});
    const e=new EmbedBuilder().setTitle('لوحة تحكم المالك').setColor(0x2B2D31);
    const m=new StringSelectMenuBuilder().setCustomId('owner_setup').setPlaceholder('اختر...')
      .addOptions([
        {label:'تخصيص لوحة البوسترز', value:'custom_panel', emoji:'🎨'},
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
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('رابط صورة كبيرة').setStyle(TextInputStyle.Short).setValue(get('panel_image')||'').setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('thumb').setLabel('رابط صورة مصغرة').setStyle(TextInputStyle.Short).setValue(get('panel_thumb')||'').setRequired(false))
      );
      return i.showModal(modal);
    }
    if(v==='set_log'){ set('logChannel', i.channelId); return i.reply({content:'✅ تم تحديد اللوق',ephemeral:true}); }
    if(v==='manager'){
      const modal=new ModalBuilder().setCustomId('toggle_manager').setTitle('إضافة/إزالة مسؤول');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('ID العضو').setStyle(TextInputStyle.Short).setRequired(true)));
      return i.showModal(modal);
    }
    if(v==='list'){ const r=db.prepare('SELECT * FROM roles').all(); return i.reply({content:r.map(x=>`<@&${x.roleId}> - <@${x.userId}>`).join('\n')||'لا يوجد',ephemeral:true}); }
  }

  if(i.isModalSubmit() && i.customId==='panel_edit'){
    set('panel_title', i.fields.getTextInputValue('title'));
    set('panel_desc', i.fields.getTextInputValue('desc'));
    set('panel_color', i.fields.getTextInputValue('color'));
    set('panel_image', i.fields.getTextInputValue('image'));
    set('panel_thumb', i.fields.getTextInputValue('thumb'));
    return i.reply({content:'✅ تم الحفظ',ephemeral:true});
  }

  if(i.isModalSubmit() && i.customId==='toggle_manager'){
    await i.deferReply({ephemeral:true});
    const id=i.fields.getTextInputValue('id').replace(/[<@!>]/g,'');
    const managers=JSON.parse(get('managers')||'[]');
    const idx=managers.indexOf(id);
    if(idx>-1) managers.splice(idx,1); else managers.push(id);
    set('managers', JSON.stringify(managers));
    return i.editReply(idx>-1?'✅ تمت إزالة المسؤول':'✅ تمت إضافة المسؤول');
  }

  // /roles - المسؤول والإدارة
  if(i.isChatInputCommand() && i.commandName==='roles'){
    if(!i.memberPermissions.has(PermissionFlagsBits.Administrator) && !isManager(i.user.id)) return i.reply({content:'❌',ephemeral:true});
    await i.deferReply({ephemeral:true});
    try{
      const p=buildBoosterPanel();
      await i.channel.send({embeds:[p.embed],components:[p.row]});
      await i.editReply('✅ تم الإرسال');
    }catch(e){ await i.editReply('❌ تأكد من صلاحياتي'); }
    return;
  }

  // منيو البوسترز
  if(i.isStringSelectMenu() && i.customId==='booster_menu'){
    const action=i.values[0];
    const data=db.prepare('SELECT * FROM roles WHERE userId=?').get(i.user.id);
    const member=await i.guild.members.fetch(i.user.id);
    if(!isBooster(member)) return i.reply({content:'❌ لازم بوستر',ephemeral:true});

    if(action==='create'){
      if(data) return i.reply({content:'❌ عندك رول',ephemeral:true});
      const m=new ModalBuilder().setCustomId('create_role').setTitle('إنشاء رولي');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('اسم الرول').setStyle(TextInputStyle.Short).setRequired(true)));
      return i.showModal(m);
    }
    if(action==='rename'){
      if(!data) return i.reply({content:'❌ ما عندك رول',ephemeral:true});
      const m=new ModalBuilder().setCustomId('rename_role').setTitle('تغيير اسم الرول');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('الاسم الجديد').setStyle(TextInputStyle.Short).setValue(data.name).setRequired(true)));
      return i.showModal(m);
    }
    if(action==='share'){
      if(!data) return i.reply({content:'❌ ما عندك رول',ephemeral:true});
      const m=new ModalBuilder().setCustomId('share_role').setTitle('مشاركة الرول');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('ID العضو').setStyle(TextInputStyle.Short).setRequired(true)));
      return i.showModal(m);
    }
    if(action==='color'){
      if(!data) return i.reply({content:'❌ ما عندك رول',ephemeral:true});
      const m=new ModalBuilder().setCustomId('color_role').setTitle('تغيير لون الرول');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('HEX').setStyle(TextInputStyle.Short).setValue(data.color||'#2B2D31').setRequired(true)));
      return i.showModal(m);
    }
    if(action==='icon'){
      if(!data) return i.reply({content:'❌ ما عندك رول',ephemeral:true});
      const m=new ModalBuilder().setCustomId('icon_role').setTitle('تغيير أيقونة الرول');
      m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('icon').setLabel('رابط').setStyle(TextInputStyle.Short).setRequired(false)));
      return i.showModal(m);
    }
    await i.deferReply({ephemeral:true});
    if(action==='unshare'){
      if(!data) return i.editReply('❌');
      const members=JSON.parse(data.members).filter(id=>id!==i.user.id);
      if(!members.length) return i.editReply('❌ لا يوجد');
      const mem=await i.guild.members.fetch(members[0]).catch(()=>null);
      if(mem) await mem.roles.remove(data.roleId);
      db.prepare('UPDATE roles SET members=? WHERE userId=?').run(JSON.stringify([i.user.id]),i.user.id);
      return i.editReply('✅ تمت الإزالة');
    }
    if(action==='delete'){
      if(!data) return i.editReply('❌');
      const role=await i.guild.roles.fetch(data.roleId).catch(()=>null);
      if(role) await role.delete();
      db.prepare('DELETE FROM roles WHERE userId=?').run(i.user.id);
      return i.editReply('✅ تم الحذف');
    }
  }

  // مودالات الرول
  if(i.isModalSubmit() && i.customId==='create_role'){
    await i.deferReply({ephemeral:true});
    const name=i.fields.getTextInputValue('name');
    const role=await i.guild.roles.create({name, reason:'رول بوستر'});
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
    return i.editReply('✅ تم التغيير');
  }
  if(i.isModalSubmit() && i.customId==='share_role'){
    await i.deferReply({ephemeral:true});
    const data=db.prepare('SELECT * FROM roles WHERE userId=?').get(i.user.id);
    const mem=await i.guild.members.fetch(i.fields.getTextInputValue('id')).catch(()=>null);
    if(!mem) return i.editReply('❌');
    await mem.roles.add(data.roleId);
    const members=JSON.parse(data.members); members.push(mem.id);
    db.prepare('UPDATE roles SET members=? WHERE userId=?').run(JSON.stringify(members),i.user.id);
    return i.editReply(`✅ تمت المشاركة`);
  }
  if(i.isModalSubmit() && i.customId==='color_role'){
    await i.deferReply({ephemeral:true});
    const data=db.prepare('SELECT * FROM roles WHERE userId=?').get(i.user.id);
    const role=await i.guild.roles.fetch(data.roleId);
    await role.setColor(i.fields.getTextInputValue('color'));
    db.prepare('UPDATE roles SET color=? WHERE userId=?').run(i.fields.getTextInputValue('color'),i.user.id);
    return i.editReply('✅ تم');
  }
  if(i.isModalSubmit() && i.customId==='icon_role'){
    await i.deferReply({ephemeral:true});
    const data=db.prepare('SELECT * FROM roles WHERE userId=?').get(i.user.id);
    const role=await i.guild.roles.fetch(data.roleId);
    await role.setIcon(parseIcon(i.fields.getTextInputValue('icon')));
    return i.editReply('✅ تم');
  }

  }catch(e){ console.error(e); }
});

client.login(process.env.TOKEN);
