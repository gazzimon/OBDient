import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';

const MINT = '#2DE1A5';
const MUTED = '#9A9A9A';
const BG = '#0D0D0D';
const BORDER = '#2C2C2E';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={name} color={color} size={size} />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: MINT,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          backgroundColor: BG,
          borderTopColor: BORDER,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontFamily: 'IBMPlexMono_400Regular',
          fontSize: 10,
        },
        sceneStyle: { backgroundColor: BG },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Dashboard', tabBarIcon: tabIcon('gauge') }}
      />
      <Tabs.Screen
        name="diagnostics"
        options={{ title: 'Diagnostics', tabBarIcon: tabIcon('car-wrench') }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: 'Reports', tabBarIcon: tabIcon('file-document-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: tabIcon('cog-outline') }}
      />
    </Tabs>
  );
}
