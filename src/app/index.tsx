import { View, Text } from 'react-native';

export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-brand-bg">
      <Text className="text-brand-teal text-2xl font-bold">OBDient</Text>
      <Text className="text-brand-muted text-sm mt-2">Tu auto, por fin obediente.</Text>
    </View>
  );
}
