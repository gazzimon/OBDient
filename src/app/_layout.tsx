import '../global.css';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import {
  useFonts,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_700Bold,
  });

  // Render a black screen until fonts are ready — avoids font flashing
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#0D0D0D' }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0D0D0D' },
      }}
    />
  );
}
