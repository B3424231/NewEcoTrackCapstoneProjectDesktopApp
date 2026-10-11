import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  Platform,
  ActivityIndicator,
  Dimensions,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { ThemedText } from './themed-text';
import { AppIcon } from './app-icon';
import { useSettings } from '@/context/settings-context';
import { useAuth } from '@/context/auth-context';
import { DeviceService, AvailableRoomOption } from '@/services/device-service';
import {
  AcControllerService,
  AcControllerDevice,
  POPULAR_AC_BRANDS,
  SUPPORTED_IR_PROTOCOLS,
  CapabilityEngine,
} from '@/services/ac-controller-service';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const AIRCON_TYPES = [
  'Split Type (Inverter)',
  'Window Type (Inverter)',
  'Floor Mounted AC',
  'Cassette Type (Inverter)',
  'Centralized HVAC',
];

const CLIMATE_MODES = ['cool', 'dry', 'fan', 'auto'];

export interface AddAcControllerModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved?: (device: AcControllerDevice) => void;
  initialDevice?: AcControllerDevice | null;
  initialTab?: 'info' | 'ir'; // preserved for backward-compatibility
}

export function AddAcControllerModal({
  visible,
  onClose,
  onSaved,
  initialDevice,
}: AddAcControllerModalProps) {
  const { effectiveTheme, triggerHaptic, colors } = useSettings();
  const { userName } = useAuth();
  const isDark = effectiveTheme === 'dark';

  // AC Controller Information Form State
  const [deviceId, setDeviceId] = useState('');
  const [unitName, setUnitName] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [customBrand, setCustomBrand] = useState('');
  const [selectedAirconType, setSelectedAirconType] = useState('Split Type (Inverter)');
  const [selectedProtocol, setSelectedProtocol] = useState<string>('generic_ac');
  
  // Climate defaults
  const [defaultPower, setDefaultPower] = useState<'ON' | 'OFF'>('ON');
  const [defaultTemp, setDefaultTemp] = useState<number>(24);
  const [defaultMode, setDefaultMode] = useState<string>('cool');

  // Room Assignment State
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedRoomName, setSelectedRoomName] = useState('');
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [availableRooms, setAvailableRooms] = useState<AvailableRoomOption[]>([]);
  const [showRoomPicker, setShowRoomPicker] = useState(false);

  // Available Nodes from ESP32 network
  const [availableNodes, setAvailableNodes] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize or reset state on modal open
  useEffect(() => {
    if (visible) {
      loadRoomsAndNodes();

      if (initialDevice) {
        setDeviceId(initialDevice.deviceId);
        setUnitName(initialDevice.name);
        setNodeId(initialDevice.nodeId);
        setSelectedBrand(initialDevice.brand || '');
        setCustomBrand(initialDevice.brand || '');
        setSelectedAirconType(initialDevice.airconType || 'Split Type (Inverter)');
        setSelectedProtocol(initialDevice.protocol || CapabilityEngine.resolveProtocolName(initialDevice.brand));
        setSelectedRoomId(initialDevice.roomId || null);
        setSelectedRoomName(initialDevice.roomName || '');
        setDefaultPower(initialDevice.power || 'ON');
        setDefaultTemp(initialDevice.setTemp || 24);
      } else {
        const generatedId = `AC-${Math.floor(100 + Math.random() * 900)}`;
        setDeviceId(generatedId);
        setUnitName('');
        setNodeId('');
        setSelectedBrand('');
        setCustomBrand('');
        setSelectedAirconType('Split Type (Inverter)');
        setSelectedProtocol('generic_ac');
        setSelectedRoomId(null);
        setSelectedRoomName('');
        setDefaultPower('ON');
        setDefaultTemp(24);
        setDefaultMode('cool');
      }
    }
  }, [visible, initialDevice]);

  const loadRoomsAndNodes = async () => {
    try {
      const [rooms, devices] = await Promise.all([
        DeviceService.fetchAvailableRooms(),
        DeviceService.getDevices(),
      ]);
      setAvailableRooms(Array.isArray(rooms) ? rooms : []);
      const sanitizedNodes = (devices || [])
        .map((d: any) => {
          if (!d) return '';
          if (typeof d === 'string') return d.trim();
          if (typeof d.deviceId === 'string' && d.deviceId.trim()) return d.deviceId.trim();
          if (typeof d.name === 'string' && d.name.trim()) return d.name.trim();
          if (typeof d.id === 'string' && d.id.trim()) return d.id.trim();
          return '';
        })
        .filter((s): s is string => typeof s === 'string' && s.length > 0);
      setAvailableNodes(Array.from(new Set(sanitizedNodes)));
    } catch {
      setAvailableRooms([]);
      setAvailableNodes([]);
    }
  };

  const handleBrandSelect = (brand: string) => {
    triggerHaptic();
    setSelectedBrand(brand);
    const resolved = CapabilityEngine.resolveProtocolName(brand === 'Other / Generic' ? (customBrand || 'generic') : brand);
    setSelectedProtocol(resolved);
  };

  const handleTempAdjust = (delta: number) => {
    triggerHaptic();
    setDefaultTemp((prev) => Math.max(16, Math.min(30, prev + delta)));
  };

  const handleSaveDevice = async () => {
    if (!unitName.trim()) {
      Alert.alert('Required Field', 'Please enter a name for this AC Controller.');
      return;
    }
    if (!deviceId.trim()) {
      Alert.alert('Required Field', 'Please provide an AC Controller Device ID.');
      return;
    }

    const effectiveBrand = (selectedBrand === 'Other / Generic' ? customBrand : (customBrand || selectedBrand)).trim();
    if (!effectiveBrand) {
      Alert.alert('Required Field', 'Please custom assign the Air Conditioner brand.');
      return;
    }

    triggerHaptic();
    setIsSaving(true);

    try {
      const savedDevice = await AcControllerService.saveAircon({
        id: deviceId.trim(),
        deviceId: deviceId.trim(),
        name: unitName.trim(),
        nodeId: nodeId.trim() || `node-${deviceId.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        brand: effectiveBrand,
        protocol: selectedProtocol,
        protocolName: selectedProtocol,
        airconType: selectedAirconType,
        roomId: selectedRoomId,
        roomName: selectedRoomName || 'Unassigned',
        location: selectedRoomName || 'Unassigned',
        power: defaultPower,
        setTemp: defaultTemp,
        status: 'online',
        registeredBy: userName || 'Maintenance Staff',
      });

      setIsSaving(false);
      Alert.alert(
        'AC Controller Saved',
        `"${savedDevice.name}" is successfully configured with ${selectedProtocol} protocol.`,
        [
          {
            text: 'OK',
            onPress: () => {
              if (onSaved) onSaved(savedDevice);
              onClose();
            },
          },
        ]
      );
    } catch (err: any) {
      setIsSaving(false);
      Alert.alert('Error', err.message || 'Could not save AC Controller.');
    }
  };

  const filteredRooms = availableRooms.filter((r) => {
    if (!roomSearchQuery.trim()) return true;
    const q = roomSearchQuery.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.floorName.toLowerCase().includes(q) ||
      r.buildingName.toLowerCase().includes(q)
    );
  });

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardContainer}
        >
          <View
            style={[
              styles.sheetContent,
              {
                backgroundColor: isDark ? '#0b1b13' : '#ffffff',
                borderColor: isDark ? 'rgba(16, 185, 129, 0.3)' : '#cbd5e1',
              },
            ]}
          >
            {/* Sheet Header */}
            <View style={styles.sheetHeader}>
              <View style={styles.headerLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="bolt" size={20} color="#10b981" />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.headerTitle}>
                    {initialDevice ? 'Edit AC Controller' : 'Add AC Controller Device'}
                  </ThemedText>
                  <ThemedText style={styles.headerSubtitle}>
                    Configure unit identity, protocol & room binding
                  </ThemedText>
                </View>
              </View>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
                hitSlop={12}
              >
                <ThemedText style={styles.closeBtnText}>✕</ThemedText>
              </Pressable>
            </View>

            {/* Form Scroll Area */}
            <ScrollView
              style={styles.scrollBody}
              contentContainerStyle={{ paddingBottom: 32 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Field: Custom Aircon Name */}
              <View style={styles.fieldGroup}>
                <ThemedText style={styles.fieldLabel}>
                  Custom Aircon Name <ThemedText style={{ color: '#ef4444' }}>*</ThemedText>
                </ThemedText>
                <TextInput
                  style={[
                    styles.inputBox,
                    {
                      backgroundColor: isDark ? 'rgba(0,0,0,0.35)' : '#f8fafc',
                      borderColor: isDark ? 'rgba(255,255,255,0.15)' : '#cbd5e1',
                      color: isDark ? '#ffffff' : '#0f172a',
                    },
                  ]}
                  placeholder="e.g. Server Room A Split AC or Lab 204 Aircon"
                  placeholderTextColor="#94a3b8"
                  value={unitName}
                  onChangeText={setUnitName}
                />
              </View>

              {/* Field Row: Device ID & Node ID */}
              <View style={styles.twoColumnRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.fieldLabel}>
                    Device ID <ThemedText style={{ color: '#ef4444' }}>*</ThemedText>
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.inputBox,
                      {
                        backgroundColor: isDark ? 'rgba(0,0,0,0.35)' : '#f8fafc',
                        borderColor: isDark ? 'rgba(255,255,255,0.15)' : '#cbd5e1',
                        color: isDark ? '#ffffff' : '#0f172a',
                      },
                    ]}
                    placeholder="e.g. AC-001"
                    placeholderTextColor="#94a3b8"
                    value={deviceId}
                    onChangeText={setDeviceId}
                    autoCapitalize="characters"
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.fieldLabel}>Controller Node ID</ThemedText>
                  <TextInput
                    style={[
                      styles.inputBox,
                      {
                        backgroundColor: isDark ? 'rgba(0,0,0,0.35)' : '#f8fafc',
                        borderColor: isDark ? 'rgba(255,255,255,0.15)' : '#cbd5e1',
                        color: isDark ? '#ffffff' : '#0f172a',
                      },
                    ]}
                    placeholder="e.g. node-1"
                    placeholderTextColor="#94a3b8"
                    value={nodeId}
                    onChangeText={setNodeId}
                  />
                </View>
              </View>

              {/* Suggested Nodes Chips */}
              {availableNodes.length > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <ThemedText style={styles.hintLabel}>Detected Hardware Nodes:</ThemedText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nodeChipsScroll}>
                    {availableNodes.map((n) => (
                      <Pressable
                        key={n}
                        onPress={() => {
                          triggerHaptic();
                          setNodeId(n);
                        }}
                        style={[
                          styles.nodeChip,
                          nodeId === n && styles.nodeChipActive,
                          {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9',
                            borderColor: nodeId === n ? '#10b981' : isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0',
                          },
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.nodeChipText,
                            nodeId === n && { color: '#10b981', fontWeight: '800' },
                          ]}
                        >
                          {n}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Room Assignment */}
              <View style={styles.fieldGroup}>
                <ThemedText style={styles.fieldLabel}>Room / Campus Location</ThemedText>
                <Pressable
                  onPress={() => {
                    triggerHaptic();
                    setShowRoomPicker(true);
                  }}
                  style={[
                    styles.roomPickerTrigger,
                    {
                      backgroundColor: isDark ? 'rgba(0,0,0,0.35)' : '#f8fafc',
                      borderColor: selectedRoomId ? '#10b981' : isDark ? 'rgba(255,255,255,0.15)' : '#cbd5e1',
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <AppIcon name="location" size={16} color="#10b981" />
                    <ThemedText
                      style={[
                        styles.roomPickerTriggerText,
                        { color: selectedRoomName ? (isDark ? '#ffffff' : '#0f172a') : '#94a3b8' },
                      ]}
                      numberOfLines={1}
                    >
                      {selectedRoomName || 'Select room assignment...'}
                    </ThemedText>
                  </View>
                  <ThemedText style={{ color: '#10b981', fontSize: 12, fontWeight: '700' }}>
                    {selectedRoomName ? 'Change' : 'Browse'}
                  </ThemedText>
                </Pressable>
              </View>

              {/* Field: Custom AC Brand Selection (Custom Assign Form) */}
              <View style={styles.fieldGroup}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <ThemedText style={styles.fieldLabel}>
                    Custom Aircon Brand <ThemedText style={{ color: '#ef4444' }}>*</ThemedText>
                  </ThemedText>
                  <ThemedText style={{ fontSize: 10.5, color: '#10b981', fontWeight: '700' }}>
                    Custom Assign
                  </ThemedText>
                </View>
                {(customBrand || selectedBrand).trim() ? (
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5',
                    borderColor: isDark ? 'rgba(16, 185, 129, 0.4)' : '#a7f3d0',
                    borderWidth: 1,
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    marginBottom: 8,
                  }}>
                    <AppIcon name="check-circle" size={14} color="#10b981" />
                    <ThemedText style={{ fontSize: 11.5, fontWeight: '700', color: isDark ? '#34d399' : '#047857' }}>
                      Custom Assigned: {(customBrand || selectedBrand).trim()} {selectedAirconType ? `(${selectedAirconType})` : ''}
                    </ThemedText>
                  </View>
                ) : null}
                <TextInput
                  style={[
                    styles.inputBox,
                    {
                      backgroundColor: isDark ? 'rgba(0,0,0,0.35)' : '#f8fafc',
                      borderColor: (customBrand || selectedBrand).trim() ? '#10b981' : (isDark ? 'rgba(255,255,255,0.15)' : '#cbd5e1'),
                      color: isDark ? '#ffffff' : '#0f172a',
                      marginBottom: 8,
                    },
                  ]}
                  placeholder="Custom assign brand (e.g. Daikin, Carrier, Koppel, Midea)..."
                  placeholderTextColor="#94a3b8"
                  value={customBrand || selectedBrand}
                  onChangeText={(val) => {
                    setCustomBrand(val);
                    setSelectedBrand(val);
                    setSelectedProtocol(CapabilityEngine.resolveProtocolName(val));
                  }}
                />

                <ThemedText style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: '600' }}>
                  Quick Brand Presets:
                </ThemedText>
                <View style={styles.brandGrid}>
                  {POPULAR_AC_BRANDS.filter((b) => b !== 'Other / Generic').slice(0, 10).map((b) => {
                    const currentBrand = (customBrand || selectedBrand).trim().toLowerCase();
                    const isSelected = currentBrand === b.toLowerCase();
                    return (
                      <Pressable
                        key={b}
                        onPress={() => {
                          triggerHaptic();
                          setCustomBrand(b);
                          setSelectedBrand(b);
                          setSelectedProtocol(CapabilityEngine.resolveProtocolName(b));
                        }}
                        style={[
                          styles.brandPill,
                          isSelected && styles.brandPillActive,
                          {
                            backgroundColor: isSelected
                              ? '#10b981'
                              : isDark
                              ? 'rgba(255,255,255,0.06)'
                              : '#f8fafc',
                            borderColor: isSelected
                              ? '#059669'
                              : isDark
                              ? 'rgba(255,255,255,0.1)'
                              : '#e2e8f0',
                          },
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.brandPillText,
                            isSelected && { color: '#ffffff', fontWeight: '800' },
                          ]}
                        >
                          {b}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Field: Air Conditioner Type */}
              <View style={styles.fieldGroup}>
                <ThemedText style={styles.fieldLabel}>Air Conditioner Appliance Type</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                  {AIRCON_TYPES.map((t) => {
                    const isSelected = selectedAirconType === t;
                    return (
                      <Pressable
                        key={t}
                        onPress={() => {
                          triggerHaptic();
                          setSelectedAirconType(t);
                        }}
                        style={[
                          styles.typeChip,
                          isSelected && styles.typeChipActive,
                          {
                            backgroundColor: isSelected
                              ? (isDark ? 'rgba(16, 185, 129, 0.2)' : '#ecfdf5')
                              : (isDark ? 'rgba(255, 255, 255, 0.05)' : '#f8fafc'),
                            borderColor: isSelected
                              ? '#10b981'
                              : (isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0'),
                          },
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.typeChipText,
                            isSelected && { color: '#10b981', fontWeight: '800' },
                          ]}
                        >
                          {t}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Climate Library Protocol */}
              <View style={[
                styles.protocolBanner,
                {
                  backgroundColor: isDark ? 'rgba(16, 185, 129, 0.1)' : '#f0fdf4',
                  borderColor: isDark ? 'rgba(16, 185, 129, 0.25)' : '#bbf7d0',
                }
              ]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <AppIcon name="bolt" size={16} color="#10b981" />
                  <ThemedText style={styles.protocolBannerTitle}>
                    Climate Protocol: <ThemedText style={{ fontWeight: '900', color: '#10b981' }}>{selectedProtocol}</ThemedText>
                  </ThemedText>
                </View>
                <ThemedText style={styles.protocolBannerDesc}>
                  Configured with standard protocol library for seamless full-state air conditioner management.
                </ThemedText>
              </View>

              {/* Initial Climate Settings */}
              <View style={styles.fieldGroup}>
                <ThemedText style={styles.fieldLabel}>Initial Operating Settings</ThemedText>
                <View style={[
                  styles.settingsCard,
                  {
                    backgroundColor: isDark ? 'rgba(0,0,0,0.25)' : '#f8fafc',
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0',
                  }
                ]}>
                  {/* Power Row */}
                  <View style={styles.settingsRow}>
                    <ThemedText style={styles.settingLabel}>Default Power</ThemedText>
                    <View style={styles.powerBtnGroup}>
                      <Pressable
                        onPress={() => {
                          triggerHaptic();
                          setDefaultPower('ON');
                        }}
                        style={[
                          styles.powerToggleBtn,
                          defaultPower === 'ON' && styles.powerToggleBtnActiveOn,
                        ]}
                      >
                        <ThemedText style={[styles.powerToggleText, defaultPower === 'ON' && { color: '#ffffff', fontWeight: '800' }]}>
                          ON
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          triggerHaptic();
                          setDefaultPower('OFF');
                        }}
                        style={[
                          styles.powerToggleBtn,
                          defaultPower === 'OFF' && styles.powerToggleBtnActiveOff,
                        ]}
                      >
                        <ThemedText style={[styles.powerToggleText, defaultPower === 'OFF' && { color: '#ffffff', fontWeight: '800' }]}>
                          OFF
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>

                  {/* Target Temp Row */}
                  <View style={styles.settingsRow}>
                    <ThemedText style={styles.settingLabel}>Target Temperature</ThemedText>
                    <View style={styles.tempStepper}>
                      <Pressable onPress={() => handleTempAdjust(-1)} style={styles.stepperBtn}>
                        <ThemedText style={styles.stepperBtnText}>−</ThemedText>
                      </Pressable>
                      <ThemedText style={styles.tempDisplayText}>{defaultTemp}°C</ThemedText>
                      <Pressable onPress={() => handleTempAdjust(1)} style={styles.stepperBtn}>
                        <ThemedText style={styles.stepperBtnText}>+</ThemedText>
                      </Pressable>
                    </View>
                  </View>

                  {/* Mode Row */}
                  <View style={[styles.settingsRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                    <ThemedText style={styles.settingLabel}>Mode</ThemedText>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {CLIMATE_MODES.map((m) => {
                        const isM = defaultMode === m;
                        return (
                          <Pressable
                            key={m}
                            onPress={() => {
                              triggerHaptic();
                              setDefaultMode(m);
                            }}
                            style={[
                              styles.modePill,
                              isM && styles.modePillActive,
                              {
                                backgroundColor: isM ? '#10b981' : isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0',
                              }
                            ]}
                          >
                            <ThemedText style={[styles.modePillText, isM && { color: '#ffffff', fontWeight: '800' }]}>
                              {m.toUpperCase()}
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </View>
              </View>

              {/* Save AC Controller Device Button */}
              <Pressable
                onPress={handleSaveDevice}
                disabled={isSaving}
                style={({ pressed }) => [
                  styles.saveButton,
                  pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
                  isSaving && { opacity: 0.7 },
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <AppIcon name="check-circle" size={18} color="#ffffff" />
                    <ThemedText style={styles.saveButtonText}>
                      {initialDevice ? 'Update AC Controller' : 'Save AC Controller Device'}
                    </ThemedText>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>

        {/* Room Picker Search Modal */}
        <Modal
          visible={showRoomPicker}
          animationType="fade"
          transparent
          onRequestClose={() => setShowRoomPicker(false)}
        >
          <View style={styles.pickerBackdrop}>
            <View
              style={[
                styles.pickerDialog,
                {
                  backgroundColor: isDark ? '#0f172a' : '#ffffff',
                  borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0',
                },
              ]}
            >
              <View style={styles.pickerHeader}>
                <ThemedText style={styles.pickerTitle}>Select Campus Room</ThemedText>
                <Pressable onPress={() => setShowRoomPicker(false)} hitSlop={10}>
                  <ThemedText style={styles.pickerClose}>✕</ThemedText>
                </Pressable>
              </View>

              <TextInput
                style={[
                  styles.pickerSearchInput,
                  {
                    backgroundColor: isDark ? 'rgba(0,0,0,0.4)' : '#f1f5f9',
                    color: isDark ? '#ffffff' : '#0f172a',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#cbd5e1',
                  },
                ]}
                placeholder="Search rooms, floors, buildings..."
                placeholderTextColor="#94a3b8"
                value={roomSearchQuery}
                onChangeText={setRoomSearchQuery}
              />

              <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                {filteredRooms.map((r) => {
                  const isCur = selectedRoomId === r.id;
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => {
                        triggerHaptic();
                        setSelectedRoomId(r.id);
                        setSelectedRoomName(`${r.name} (${r.floorName})`);
                        // Aircon brand is NOT auto-assigned - must be custom assigned by user
                        if (r.airconType && !selectedAirconType) {
                          setSelectedAirconType(r.airconType);
                        }
                        if (!unitName.trim()) {
                          setUnitName(r.airconName || `${r.name} Aircon`);
                        }
                        setShowRoomPicker(false);
                      }}
                      style={[
                        styles.roomItem,
                        isCur && styles.roomItemActive,
                        { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9' },
                      ]}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <ThemedText style={[styles.roomItemName, isCur && { color: '#10b981', fontWeight: '800' }]}>
                            {r.name}
                          </ThemedText>
                          {r.airconBrand ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: isDark ? 'rgba(16, 185, 129, 0.18)' : '#ecfdf5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: isDark ? 'rgba(16, 185, 129, 0.4)' : '#a7f3d0' }}>
                              <AppIcon name="bolt" size={10} color="#10b981" />
                              <ThemedText style={{ fontSize: 10, fontWeight: '800', color: isDark ? '#34d399' : '#059669' }}>
                                {r.airconBrand}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                        <ThemedText style={styles.roomItemPath}>
                          {r.buildingName} • {r.floorName}
                          {r.airconType ? ` • ${r.airconType}` : ''}
                          {r.nodeName ? ` • Node: ${r.nodeName}` : ''}
                        </ThemedText>
                      </View>
                      {isCur && <AppIcon name="check-circle" size={16} color="#10b981" />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  keyboardContainer: {
    width: '100%',
  },
  sheetContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingTop: 16,
    paddingHorizontal: 20,
    maxHeight: '90%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.2)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 11.5,
    color: '#94a3b8',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
  },
  scrollBody: {
    marginTop: 14,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    marginBottom: 6,
    color: '#10b981',
  },
  hintLabel: {
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 6,
    fontWeight: '600',
  },
  inputBox: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '600',
  },
  twoColumnRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  nodeChipsScroll: {
    marginHorizontal: -4,
  },
  nodeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: 4,
  },
  nodeChipActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  nodeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  roomPickerTrigger: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roomPickerTriggerText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  brandGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  brandPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  brandPillActive: {},
  brandPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginHorizontal: 4,
  },
  typeChipActive: {},
  typeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  protocolBanner: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    gap: 4,
  },
  protocolBannerTitle: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  protocolBannerDesc: {
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 16,
  },
  settingsCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  settingLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  powerBtnGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  powerToggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  powerToggleBtnActiveOn: {
    backgroundColor: '#10b981',
  },
  powerToggleBtnActiveOff: {
    backgroundColor: '#ef4444',
  },
  powerToggleText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#94a3b8',
  },
  tempStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#10b981',
    lineHeight: 20,
  },
  tempDisplayText: {
    fontSize: 15,
    fontWeight: '800',
    minWidth: 44,
    textAlign: 'center',
  },
  modePill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
  },
  modePillActive: {},
  modePillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#94a3b8',
  },
  saveButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  pickerDialog: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  pickerClose: {
    fontSize: 14,
    fontWeight: '800',
    color: '#94a3b8',
  },
  pickerSearchInput: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  roomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  roomItemActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  roomItemName: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  roomItemPath: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
});
