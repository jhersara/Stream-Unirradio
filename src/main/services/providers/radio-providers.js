const PROVIDERS = {
  'zeno-icecast': {
    id: 'zeno-icecast',
    label: 'Zeno.fm · Icecast',
    shortLabel: 'Zeno.fm',
    protocol: 'icecast',
    requiresUser: true,
    requiresMount: true,
    defaultPort: '80',
    defaultUser: 'source',
    serverPlaceholder: 'link.zeno.fm',
    mountPlaceholder: 'Copiar exactamente desde Broadcast Settings de Zeno.fm',
    help: 'Usa el servidor, puerto, mountpoint y contraseña que aparecen en Broadcast Settings de Zeno.fm.'
  },
  'centova-icecast': {
    id: 'centova-icecast',
    label: 'Centova Cast · Icecast',
    shortLabel: 'Centova · Icecast',
    protocol: 'icecast',
    requiresUser: true,
    requiresMount: true,
    defaultPort: '8000',
    defaultUser: 'source',
    serverPlaceholder: 'stream.tuservidor.com',
    mountPlaceholder: 'Ej. /radio.mp3',
    help: 'Selecciona esta opción si Live Source Connections de Centova indica Icecast y proporciona un mountpoint.'
  },
  'centova-shoutcast': {
    id: 'centova-shoutcast',
    label: 'Centova Cast · SHOUTcast',
    shortLabel: 'Centova · SHOUTcast',
    protocol: 'shoutcast',
    requiresUser: false,
    sourceProtocol: 'shoutcast-icy',
    outputMode: 'shoutcast-source',
    requiresMount: false,
    defaultPort: '8000',
    defaultUser: 'source',
    serverPlaceholder: 'stream.tuservidor.com',
    mountPlaceholder: 'Opcional; usa el Stream ID si tu proveedor lo solicita',
    help: 'Selecciona esta opción si Live Source Connections de Centova indica SHOUTcast. El usuario suele ser source; confirma la contraseña con tu proveedor.'
  }
};

function getProvider(providerId) {
  return PROVIDERS[providerId] || PROVIDERS['zeno-icecast'];
}

function listProviders() {
  return Object.values(PROVIDERS).map(({ id, label, shortLabel, protocol, requiresUser, sourceProtocol, outputMode, requiresMount, defaultPort, defaultUser, serverPlaceholder, mountPlaceholder, help }) => ({
    id, label, shortLabel, protocol, requiresUser, sourceProtocol, outputMode, requiresMount, defaultPort, defaultUser, serverPlaceholder, mountPlaceholder, help
  }));
}

function cleanHost(server) {
  return String(server || '')
    .trim()
    .replace(/^\w+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '');
}

function cleanMount(mount) {
  return String(mount || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function buildIcecastUrl(config, provider) {
  const user = encodeURIComponent(String(config.user || 'source'));
  const pass = encodeURIComponent(String(config.password || ''));
  const host = cleanHost(config.server);
  const port = String(config.port || provider.defaultPort);
  const mount = cleanMount(config.mount);
  const targetMount = mount || (provider.requiresMount ? 'stream' : 'stream');
  return `icecast://${user}:${pass}@${host}:${port}/${encodeURIComponent(targetMount)}`;
}

function buildEncoderProfile(config) {
  const provider = getProvider(config.provider);
  const icecastUrl = buildIcecastUrl(config, provider);
  const streamId = String(config.streamId || cleanMount(config.mount) || '1');
  const common = [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', String(config.bitrate || '128k'), '-ar', '44100',
    '-f', 'mp3'
  ];
  const icecastMetadata = [
    '-content_type', 'audio/mpeg',
    '-ice_name', String(config.stationName || 'UNIR Radio - Stream en vivo'),
    '-ice_description', String(config.stationDescription || 'Transmision en vivo via Stream Radio'),
    '-ice_genre', String(config.stationGenre || 'Various'),
    '-ice_url', String(config.stationUrl || 'https://unirradio.com'),
    '-fflags', 'nobuffer'
  ];

  if (provider.protocol === 'icecast') {
    return {
      provider,
      url: icecastUrl,
      args: [...common, ...icecastMetadata, '-legacy_icecast', '1', icecastUrl]
    };
  }

  // SHOUTcast no usa la salida icecast:// de FFmpeg. FFmpeg codifica a
  // stdout y `shoutcast-source.js` realiza el handshake ICY por TCP.
  return {
    provider,
    outputMode: 'shoutcast-source',
    sourceHost: cleanHost(config.server),
    sourcePort: Number(config.port || provider.defaultPort),
    streamId,
    args: [
      ...common,
      '-content_type', 'audio/mpeg',
      '-fflags', 'nobuffer',
      'pipe:1'
    ]
  };
}

function validateConfig(config) {
  const provider = getProvider(config.provider);
  const errors = [];
  if (!cleanHost(config.server)) errors.push('Falta el servidor o host.');
  if (!String(config.port || '').trim() || Number(config.port) < 1 || Number(config.port) > 65535) errors.push('El puerto debe estar entre 1 y 65535.');
  if (!String(config.password || '').trim()) errors.push('Falta la contraseña de emisión.');
  if (provider.requiresUser && !String(config.user || '').trim()) errors.push('Falta el usuario de fuente.');
  if (provider.requiresMount && !cleanMount(config.mount)) errors.push('Este proveedor necesita un mountpoint.');
  if (provider.protocol === 'shoutcast' && config.streamId && !/^\d+$/.test(String(config.streamId).trim())) errors.push('El Stream ID de SHOUTcast debe ser numerico.');
  return { ok: errors.length === 0, errors, provider };
}

module.exports = { getProvider, listProviders, buildEncoderProfile, validateConfig, cleanHost, cleanMount };
