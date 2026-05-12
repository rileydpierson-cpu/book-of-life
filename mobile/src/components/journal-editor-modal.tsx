import React from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { TimelineDayView } from '../app/mobile-library';
import { StatusPill } from '../ui/status-pill';

function journalTone(status: TimelineDayView['journalStatus']) {
  if (status === 'synced') return 'green';
  if (status === 'pending') return 'amber';
  return 'gray';
}

export function JournalEditorModal(props: {
  visible: boolean;
  isoDate: string;
  value: string;
  day: TimelineDayView | null;
  onChangeDate: (value: string) => void;
  onChangeText: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Journal Editor</Text>
            <Text style={styles.subtitle}>Journal always syncs when a connection is available.</Text>
          </View>
          {props.day ? <StatusPill label={props.day.journalStatus} tone={journalTone(props.day.journalStatus)} /> : null}
        </View>

        <TextInput
          style={styles.dateInput}
          value={props.isoDate}
          onChangeText={props.onChangeDate}
          autoCapitalize="none"
          placeholder="YYYY-MM-DD"
        />

        <TextInput
          style={styles.editor}
          value={props.value}
          onChangeText={props.onChangeText}
          multiline
          textAlignVertical="top"
          placeholder="Write about the day"
        />

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={props.onClose}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Close</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={props.onSave}>
            <Text style={styles.buttonText}>Save Journal</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f2ede4',
    padding: 20,
    gap: 16
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#22201a'
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#5a5345'
  },
  dateInput: {
    borderWidth: 1,
    borderColor: '#d2c7b2',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fffdfa',
    fontSize: 15,
    color: '#2f291f'
  },
  editor: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d2c7b2',
    borderRadius: 18,
    padding: 16,
    backgroundColor: '#fffdfa',
    fontSize: 16,
    color: '#2f291f'
  },
  footer: {
    flexDirection: 'row',
    gap: 12
  },
  button: {
    flex: 1,
    backgroundColor: '#2f5f87',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center'
  },
  secondaryButton: {
    backgroundColor: '#e5dccb'
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700'
  },
  secondaryButtonText: {
    color: '#4e4638'
  }
});
