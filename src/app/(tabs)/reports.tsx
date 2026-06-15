// Reports: history of saved diagnostic sessions from SQLite.
// Each item navigates to the interpretation detail screen.

import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import type { ReportListItem } from '@/domain/repositories/i-report.repository';

function SessionCard({
  item,
  onPress,
  onDelete,
}: {
  item: ReportListItem;
  onPress: () => void;
  onDelete: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-brand-surface rounded-2xl p-4 mb-3 active:opacity-70"
    >
      <View className="flex-row items-center justify-between pb-2 mb-3 border-b border-brand-border">
        <Text className="text-brand-text font-mono-bold text-sm">
          {item.startedAt.toLocaleDateString()} · {item.startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Pressable onPress={onDelete} hitSlop={8} className="active:opacity-60">
          <MaterialCommunityIcons name="trash-can-outline" size={18} color="#9A9A9A" />
        </Pressable>
      </View>

      <View className="flex-row items-center gap-4">
        <Text className={`font-mono text-xs ${item.dtcCount > 0 ? 'text-brand-amber' : 'text-brand-teal'}`}>
          {item.dtcCount === 0 ? 'No DTCs' : `${item.dtcCount} DTC${item.dtcCount > 1 ? 's' : ''}`}
        </Text>
        {item.hasInterpretation && (
          <Text className="text-brand-teal font-mono text-xs">AI interpreted</Text>
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

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <View className="flex-1 px-4 pt-3">
        <SectionHeader title="Reports" />

        {!loaded ? (
          <View className="items-center py-12">
            <ActivityIndicator color="#2DE1A5" />
          </View>
        ) : sessions.length === 0 ? (
          <View className="items-center py-12">
            <View className="w-24 h-24 rounded-full border-2 border-brand-teal items-center justify-center mb-4">
              <MaterialCommunityIcons name="file-document-outline" size={36} color="#2DE1A5" />
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
              />
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
