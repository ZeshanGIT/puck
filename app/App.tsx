import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { MAX_OPTIONS, type AlertStatus } from '@puck/shared';

// Placeholder screen. It imports @puck/shared to prove the workspace
// package resolves through Metro; the real screens come later.
const firstStatus: AlertStatus = 'pending';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Puck</Text>
      <Text>
        Alerts start as "{firstStatus}" and offer up to {MAX_OPTIONS} options.
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
  },
});
