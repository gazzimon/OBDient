// Reports: history of saved diagnostic sessions from SQLite.
// Each card navigates to the interpretation detail — and carries a tap-only
// outcome capture (ADR-0004 Phase 0): "¿se resolvió?" + cause chips derived
// deterministically from the DTC fault classes. No typing, at the user's pace.

import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import type { ReportListItem, OutcomeResolved } from '@/domain/repositories/i-report.repository';

const MINT = '#2DE1A5';
const AMBER = '#F5A623';
const MUTED = '#9A9A9A';

function OutcomePill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      className={`rounded-full px-3 py-1 border active:opacity-70 ${
        active ? 'bg-brand-teal border-brand-teal' : 'border-brand-border'
      }`}
    >
      <Text className={`font-mono text-xs ${active ? 'text-brand-bg' : 'text-brand-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function SessionCard({
  item,
  onPress,
  onDelete,
  onSaveOutcome,
}: {
  item: ReportListItem;
  onPress: () => void;
  onDelete: () => void;
  onSaveOutcome: (resolved: OutcomeResolved, rootCause: string | null) => void;
}) {
  const resolved = item.outcome?.resolved ?? null;
  const dateLine = `${item.startedAt.toLocaleDateString()} · ${item.startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  // The deterministic header; fall back to the date when a legacy row has none.
  const title = item.summary != null && item.summary !== '—' ? item.summary : null;

  return (
    <Pressable
      onPress={onPress}
      className="bg-brand-surface rounded-2xl p-4 mb-3 active:opacity-70"
    >
      <View className="flex-row items-start justify-between pb-2 mb-3 border-b border-brand-border">
        <View className="flex-1 pr-2">
          {title != null ? (
            <>
              <Text className="text-brand-text font-mono-bold text-sm" numberOfLines={1}>
                {title}
              </Text>
              <Text className="text-brand-muted font-mono text-xs mt-0.5">{dateLine}</Text>
            </>
          ) : (
            <Text className="text-brand-text font-mono-bold text-sm">{dateLine}</Text>
          )}
        </View>
        <Pressable onPress={onDelete} hitSlop={8} className="active:opacity-60 pt-0.5">
          <MaterialCommunityIcons name="trash-can-outline" size={18} color={MUTED} />
        </Pressable>
      </View>

      <View className="flex-row items-center gap-4">
        <Text className={`font-mono text-xs ${item.dtcCount > 0 ? 'text-brand-amber' : 'text-brand-teal'}`}>
          {item.dtcCount === 0 ? 'No DTCs' : `${item.dtcCount} DTC${item.dtcCount > 1 ? 's' : ''}`}
        </Text>
        {item.messageCount > 0 && (
          <Text className="text-brand-muted font-mono text-xs">
            {item.messageCount} msg{item.messageCount !== 1 ? 's' : ''}
          </Text>
        )}
        {resolved === 'yes' && (
          <Text className="font-mono text-xs ml-auto" style={{ color: MINT }}>✓ Resuelto</Text>
        )}
        {resolved === 'no' && (
          <Text className="font-mono text-xs ml-auto" style={{ color: AMBER }}>Sin resolver</Text>
        )}
      </View>

      {/* Tap-only outcome capture — feeds the learning loop (insertOutcome) */}
      <View className="mt-3 pt-3 border-t border-brand-border">
        <View className="flex-row items-center gap-2 flex-wrap">
          <Text className="text-brand-muted font-mono text-xs mr-1">¿Se resolvió?</Text>
          <OutcomePill label="Sí" active={resolved === 'yes'} onPress={() => onSaveOutcome('yes', item.outcome?.rootCause ?? null)} />
          <OutcomePill label="No" active={resolved === 'no'} onPress={() => onSaveOutcome('no', null)} />
          <OutcomePill label="Aún no" active={resolved === 'pending'} onPress={() => onSaveOutcome('pending', null)} />
        </View>

        {resolved === 'yes' && item.causeChips.length > 0 && (
          <View className="flex-row items-center gap-2 flex-wrap mt-2">
            <Text className="text-brand-muted font-mono text-xs mr-1">¿Qué era?</Text>
            {item.causeChips.map((c) => (
              <OutcomePill key={c} label={c} active={item.outcome?.rootCause === c} onPress={() => onSaveOutcome('yes', c)} />
            ))}
            <OutcomePill label="Otro" active={item.outcome?.rootCause === 'Otro'} onPress={() => onSaveOutcome('yes', 'Otro')} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

export default function ReportsScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<readonly ReportListItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await container.reportRepo.listSessions();
      setSessions(list);
    } catch (err) {
      console.warn('[Reports] failed to list sessions:', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Refresh whenever the tab gains focus (new sessions may have been saved)
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const confirmDelete = (id: string) => {
    Alert.alert('Delete report', 'This report will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void container.reportRepo.deleteSession(id).then(reload);
        },
      },
    ]);
  };

  // Optimistic: reflect the tap immediately, then persist + reload.
  const saveOutcome = useCallback(
    (id: string, resolved: OutcomeResolved, rootCause: string | null) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, outcome: { resolved, rootCause } } : s)),
      );
      void container.reportRepo.saveOutcome(id, { resolved, rootCause }).then(reload).catch((err) => {
        console.warn('[Reports] failed to save outcome:', err);
        void reload();
      });
    },
    [reload],
  );

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <View className="flex-1 px-4 pt-3">
        <SectionHeader title="Reports" />

        {!loaded ? (
          <View className="items-center py-12">
            <ActivityIndicator color={MINT} />
          </View>
        ) : sessions.length === 0 ? (
          <View className="items-center py-12">
            <View className="w-24 h-24 rounded-full border-2 border-brand-teal items-center justify-center mb-4">
              <MaterialCommunityIcons name="file-document-outline" size={36} color={MINT} />
            </View>
            <Text className="text-brand-text font-mono-bold text-base mb-1">
              No reports yet
            </Text>
            <Text className="text-brand-muted font-mono text-sm text-center leading-5">
              Saved diagnostic sessions will{'\n'}appear here
            </Text>
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => (
              <SessionCard
                item={item}
                onPress={() => router.push(`/interpretation/${item.id}`)}
                onDelete={() => confirmDelete(item.id)}
                onSaveOutcome={(resolved, rootCause) => saveOutcome(item.id, resolved, rootCause)}
              />
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
