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
      initialRouteName="diagnostics"
      screenOptions={{
        headerShown: false,
        // Hide the bar while typing: frees the space AND makes the manual
        // keyboard padding in the chat screen match the real keyboard top.
        tabBarHideOnKeyboard: true,
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
      {/* Conversation-first order (ADR-0009): the case is the product */}
      <Tabs.Screen
        name="diagnostics"
        options={{ title: 'Diagnosis', tabBarIcon: tabIcon('car-wrench') }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: 'Reports', tabBarIcon: tabIcon('file-document-outline') }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Dashboard', tabBarIcon: tabIcon('gauge') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: tabIcon('cog-outline') }}
      />
    </Tabs>
  );
}
