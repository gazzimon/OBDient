// Lightweight i18n (Beta V2 §3). No external dependency: a flat dictionary keyed
// by string id, each entry giving pt / es / en. The active language comes from
// settingsStore (Settings selector); "Assistente Sr" is a brand name and is
// never translated. Add keys here as screens are migrated.

import { useCallback } from 'react';
import { useSettingsStore, type AppLanguage } from '@/store/settingsStore';

type Entry = Record<AppLanguage, string>;

const STRINGS = {
  // ── Diagnosis screen ──
  'diag.title':            { pt: 'Diagnóstico', es: 'Diagnóstico', en: 'Diagnosis' },
  'diag.sourceCloud':      { pt: 'Nuvem', es: 'Nube', en: 'Cloud' },
  'diag.sourceOffline':    { pt: 'Offline', es: 'Offline', en: 'Offline' },
  'diag.notConnected':     {
    pt: 'Adaptador não conectado — dados ao vivo indisponíveis. Conecte em Ajustes.',
    es: 'Adaptador no conectado — datos en vivo no disponibles. Conectá en Ajustes.',
    en: 'Adapter not connected — live data unavailable. Connect in Settings.',
  },
  'diag.empty':            {
    pt: 'Conte o que está acontecendo com o seu veículo.\nVou montar o caso — veículo, sintomas, dados OBD — e trazer o Assistente Sr.',
    es: 'Contame qué está pasando con tu vehículo.\nVoy a armar el caso — vehículo, síntomas, datos OBD — y traer al Assistente Sr.',
    en: "Tell me what's going on with your vehicle.\nI'll collect the case — vehicle, symptoms, OBD data — and bring in the Assistente Sr.",
  },
  'diag.readDtcs':         { pt: 'Ler DTCs', es: 'Leer DTCs', en: 'Read DTCs' },
  'diag.reReadDtcs':       { pt: 'Reler DTCs', es: 'Releer DTCs', en: 'Re-read DTCs' },
  'diag.reading':          { pt: 'Lendo…', es: 'Leyendo…', en: 'Reading…' },
  'diag.noDtcs':           { pt: 'Sem DTCs ativos', es: 'Sin DTCs activos', en: 'No active DTCs' },
  'diag.odometer':         { pt: 'odômetro', es: 'odómetro', en: 'odometer' },
  'diag.inputPlaceholder': {
    pt: 'Descreva sintomas ou pergunte algo…',
    es: 'Describí síntomas o preguntá lo que quieras…',
    en: 'Describe symptoms or ask anything…',
  },
  'diag.consultSenior':    { pt: 'Falar com o Assistente Sr', es: 'Hablar con el Assistente Sr', en: 'Consult Assistente Sr' },
  'diag.consultingSenior': { pt: 'Consultando o Assistente Sr…', es: 'Consultando al Assistente Sr…', en: 'Consulting Assistente Sr…' },
  'diag.newTitle':         { pt: 'Novo diagnóstico', es: 'Nuevo diagnóstico', en: 'New diagnosis' },
  'diag.newBody':          {
    pt: 'A conversa atual será salva em Relatórios.',
    es: 'La conversación actual se guardará en Reportes.',
    en: 'The current conversation will be saved to Reports.',
  },
  'common.cancel':         { pt: 'Cancelar', es: 'Cancelar', en: 'Cancel' },
  'diag.startNew':         { pt: 'Começar novo', es: 'Empezar nuevo', en: 'Start new' },

  // ── Chat bubble gate/provenance flags ──
  'bubble.validated':      {
    pt: 'validado com os dados do veículo',
    es: 'validado con los datos del vehículo',
    en: 'validated against vehicle data',
  },
  'bubble.unconfirmed':    {
    pt: 'NÃO CONFIRMADO — contradiz os dados do veículo',
    es: 'NO CONFIRMADO — contradice los datos del vehículo',
    en: 'UNCONFIRMED — contradicts vehicle data',
  },
  'bubble.unverified':     {
    pt: 'contém sugestão não verificada',
    es: 'contiene sugerencia no verificada',
    en: 'contains unverified suggestion',
  },

  // ── Settings — section headers + language selector ──
  'set.language':          { pt: 'Idioma', es: 'Idioma', en: 'Language' },
  'set.vehicleConnection': { pt: 'Conexão do veículo', es: 'Conexión del vehículo', en: 'Vehicle Connection' },
  'set.alerts':            { pt: 'Alertas', es: 'Alertas', en: 'Alerts' },
  'set.polling':           { pt: 'Leitura', es: 'Sondeo', en: 'Polling' },
  'set.assistant':         { pt: 'Assistente Sr', es: 'Assistente Sr', en: 'Assistente Sr' },
  'set.offlineMode':       { pt: 'Modo offline', es: 'Modo offline', en: 'Offline mode' },
  'set.offlineModeDesc':   {
    pt: 'Roda no seu aparelho — sem internet',
    es: 'Corre en tu dispositivo — sin internet',
    en: 'Runs on your device — no internet needed',
  },
  'set.embeddedMemory':    { pt: 'Memória distribuída embebida', es: 'Memoria distribuida embebida', en: 'Embedded distributed memory' },
  'set.communityKnowledge':{ pt: 'Conhecimento da comunidade', es: 'Conocimiento de la comunidad', en: 'Community knowledge' },
  'set.communityKnowledgeDesc': {
    pt: 'Aprende com diagnósticos anônimos da comunidade. Embutido — sempre ativo.',
    es: 'Aprende de diagnósticos anónimos de la comunidad. Integrado — siempre activo.',
    en: 'Learns from anonymised diagnoses shared across the community. Built in — always on.',
  },
  'set.active':            { pt: 'ATIVA', es: 'ACTIVA', en: 'ACTIVE' },
  'set.about':             { pt: 'Sobre', es: 'Acerca de', en: 'About' },
  'set.appVersion':        { pt: 'Versão do app', es: 'Versión de la app', en: 'App version' },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

/** Non-reactive translate (for use outside React). */
export function translate(lang: AppLanguage, key: StringKey): string {
  return STRINGS[key][lang];
}

/** Reactive translator hook — re-renders when the language changes. The returned
 *  function is stable per language, so it is safe in useCallback/useMemo deps. */
export function useT(): (key: StringKey) => string {
  const lang = useSettingsStore((s) => s.language);
  return useCallback((key: StringKey) => STRINGS[key][lang], [lang]);
}
