import { View, Text } from 'react-native';

export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-brand-bg">
      <Text className="text-brand-teal font-mono-bold text-2xl">OBDient</Text>
      <Text className="text-brand-muted font-mono text-sm mt-2">Tu auto, por fin obediente.</Text>
    </View>
  );
}
