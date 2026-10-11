import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useSettings } from '@/context/settings-context';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { AppIcon } from '@/components/app-icon';
import { AddAcControllerModal } from '@/components/add-ac-controller-modal';
import {
  AcControllerService,
  AcControllerDevice,
} from '@/services/ac-controller-service';
import { subscribeToNodes } from '@/services/supabase';
import { CloudHardware } from '@/services/cloud-hardware';
import registry from '@/services/ac-capability-registry';
import { createRefreshCoordinator } from '@/services/refresh-coordinator';
import {
  ICON_AIRCONSTATE,
  ICON_SEARCH,
  ICON_TEMPERATURE,
} from '@/constants/custom-icons';

export default function AirconsScreen() {
  const { effectiveTheme, colors, triggerHaptic } = useSettings();
  const isDark = effectiveTheme === 'dark';
  const params = useLocalSearchParams<{ openAdd?: string; deviceId?: string }>();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Online' | 'Offline'>('All');
  const [aircons, setAircons] = useState<AcControllerDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedDeviceForModal, setSelectedDeviceForModal] = useState<AcControllerDevice | null>(null);
  const [transmittingId, setTransmittingId] = useState<string | null>(null);

  const loadAircons = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await AcControllerService.getAllAircons();
      setAircons(data || []);
    } catch (e) {
      console.error('Error loading AC controllers:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const refresh = createRefreshCoordinator(async isCurrent => {
      const data = await AcControllerService.getAllAircons();
      if (isCurrent()) {
        setAircons(current => data.map(next => {
          const old = current.find(ac => ac.id === next.id);
          const oldSnapshot = old?.controlSnapshot, incoming = next.controlSnapshot;
          if (!oldSnapshot || Date.parse(oldSnapshot.hardware_last_seen || '') <= Date.parse(incoming?.hardware_last_seen || '')) return next;
          // Preserve a newer receiver event while accepting newly fetched admin metadata.
          const snapshot = { ...incoming, ...Object.fromEntries(Object.entries(oldSnapshot)
            .filter(([key]) => key.startsWith('observed_remote_') || key.startsWith('hardware_'))) };
          return AcControllerService.applyHardwareState({ ...next, controlSnapshot: snapshot }, {
            node_id: next.nodeId, device_id: snapshot.hardware_device_id, last_seen: snapshot.hardware_last_seen,
          });
        }));
        setLoading(false); setRefreshing(false);
      }
    });
    void refresh.refresh();
    const unsubscribe = subscribeToNodes(() => refresh.schedule());
    const unsubscribeHardware = CloudHardware.subscribe(row => {
      if (row?.node_id) {
        // Apply the receiver event immediately, then reconcile metadata in the background.
        setAircons(current => current.map(ac => AcControllerService.applyHardwareState(ac, row)));
      }
      refresh.schedule();
    });
    return () => { refresh.dispose(); unsubscribe(); unsubscribeHardware(); };
  }, []);

  // Route changes initialize the editor through a cancellable external read.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (params.openAdd === 'true' || params.openAdd === '1') {
        if (active) { setSelectedDeviceForModal(null); setModalVisible(true); }
      } else if (params.deviceId) {
        const device = await AcControllerService.getAirconById(params.deviceId);
        if (active && device) { setSelectedDeviceForModal(device); setModalVisible(true); }
      }
    });
    return () => { active = false; };
  }, [params.openAdd, params.deviceId]);

  const onRefresh = () => {
    setRefreshing(true);
    loadAircons(false);
  };

  const handleOpenAddModal = () => {
    triggerHaptic();
    setSelectedDeviceForModal(null);
    setModalVisible(true);
  };

  const handleEditDevice = (device: AcControllerDevice) => {
    triggerHaptic();
    setSelectedDeviceForModal(device);
    setModalVisible(true);
  };

  const handleQuickPowerToggle = async (device: AcControllerDevice) => {
    triggerHaptic();
    setTransmittingId(device.deviceId);
    try {
      const state = { ...device.desiredState, power: device.power === 'ON' ? 'off' : 'on', temp: device.setTemp ?? 24, mode: device.desiredState?.mode || 'cool', fan: device.desiredState?.fan || 'auto' };
      const protocol = device.protocolName || device.protocol;
      const sent = await AcControllerService.dispatchIntent(device.nodeId, { protocol, state, aircon_id: device.id });
      if (!sent) throw new Error('Controller unavailable or transmission was not acknowledged.');
      await loadAircons(false);
      triggerHaptic();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not send control command to AC unit.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Command Failed', message);
    } finally {
      setTransmittingId(null);
    }
  };

  const handleAdjustTemp = async (device: AcControllerDevice, delta: number) => {
    triggerHaptic();
    try {
      const profile = { protocol_name: device.protocolName || device.protocol, control_snapshot: device.controlSnapshot,
        capability_profile: device.controlSnapshot?.capability_profile };
      const capability = registry.capabilities(profile, device.desiredState?.mode);
      if (!capability.temperature_controllable) throw new Error('Temperature is unavailable in this operating mode.');
      const temp = (device.setTemp ?? capability.min_temp) + Math.sign(delta) * capability.temperature_step;
      const valid = registry.validateTemperature(profile, temp, device.desiredState?.mode);
      if (!valid.valid) throw new Error(valid.message);
      const state = { ...device.desiredState, power: device.power === 'ON' ? 'on' : 'off', temp, mode: device.desiredState?.mode || 'cool', fan: device.desiredState?.fan || 'auto' };
      const protocol = device.protocolName || device.protocol;
      const sent = await AcControllerService.dispatchIntent(device.nodeId, { protocol, state, aircon_id: device.id });
      if (!sent) throw new Error('Controller unavailable or transmission was not acknowledged.');
      await loadAircons(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not send control command to AC unit.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Command Failed', message);
    }
  };

  const handleDeleteDevice = (device: AcControllerDevice) => {
    triggerHaptic();
    Alert.alert(
      'Unlink AC Controller',
      `Are you sure you want to remove "${device.name}" (${device.deviceId})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink & Delete',
          style: 'destructive',
          onPress: async () => {
            await AcControllerService.deleteAircon(device.deviceId);
            await loadAircons(false);
          },
        },
      ]
    );
  };

  const filteredUnits = aircons.filter((ac) => {
    if (filter === 'Online' && ac.status !== 'online') return false;
    if (filter === 'Offline' && ac.status !== 'offline') return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        (ac.deviceId || '').toLowerCase().includes(q) ||
        (ac.name || '').toLowerCase().includes(q) ||
        (ac.location || '').toLowerCase().includes(q) ||
        (ac.brand || '').toLowerCase().includes(q) ||
        (ac.airconType || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <LinearGradient
      colors={isDark ? ['#0b0f19', '#06080e'] : ['#f0fdf4', '#f8fafc']}
      style={[styles.container, { backgroundColor: colors.background }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 0.4 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#10b981"
              colors={['#10b981']}
            />
          }
        >
          {/* Top Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerLogoContainer}>
                <Image
                  source={require('@/assets/images/ecoTrack.png')}
                  style={styles.headerLogo}
                  contentFit="contain"
                />
              </View>
              <View>
                <ThemedText style={[styles.headerTitle, { color: colors.text }]}>AC Remote Controls</ThemedText>
                <ThemedText style={styles.headerSubtitle}>
                  Direct Unit Controls & Climate Settings
                </ThemedText>
              </View>
            </View>

            <View style={styles.unitCountBadge}>
              <ThemedText style={styles.unitCountText}>{aircons.length} Units</ThemedText>
            </View>
          </View>

          {/* Hero Action: Register AC Controller */}
          <Pressable
            onPress={handleOpenAddModal}
            style={({ pressed }) => [
              styles.heroRegisterCard,
              pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
            ]}
          >
            <LinearGradient
              colors={['#10b981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroGradient}
            >
              <View style={styles.heroLeft}>
                <View style={styles.heroIconBadge}>
                  <AppIcon name="bolt" size={22} color="#ffffff" />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.heroTitle}>Register AC Controller Device</ThemedText>
                  <ThemedText style={styles.heroDescription}>
                    Add new unit, assign room, and configure climate control protocol
                  </ThemedText>
                </View>
              </View>
              <View style={styles.heroActionCircle}>
                <ThemedText style={styles.heroActionPlus}>+</ThemedText>
              </View>
            </LinearGradient>
          </Pressable>

          {/* Search Bar */}
          <View
            style={[
              styles.searchBarContainer,
              {
                backgroundColor: isDark ? 'rgba(0, 0, 0, 0.45)' : '#ffffff',
                borderColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#e2e8f0',
              },
            ]}
          >
            <AppIcon name="search" size={16} color={isDark ? '#94a3b8' : '#64748b'} style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, { color: isDark ? '#ffffff' : '#0f172a' }]}
              placeholder="Search by ID, name, brand, or room..."
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={10}>
                <ThemedText style={{ color: '#94a3b8', fontSize: 13, fontWeight: '700' }}>
                  ✕
                </ThemedText>
              </Pressable>
            )}
          </View>

          {/* Filter Tabs */}
          <View style={styles.filterRow}>
            {(['All', 'Online', 'Offline'] as const).map((f) => {
              const isSelected = filter === f;
              return (
                <Pressable
                  key={f}
                  onPress={() => {
                    triggerHaptic();
                    setFilter(f);
                  }}
                  style={[
                    styles.filterChip,
                    isSelected && styles.filterChipActive,
                    {
                      backgroundColor: isSelected
                        ? '#10b981'
                        : isDark
                        ? 'rgba(255, 255, 255, 0.05)'
                        : '#ffffff',
                      borderColor: isSelected
                        ? '#059669'
                        : isDark
                        ? 'rgba(255, 255, 255, 0.1)'
                        : '#e2e8f0',
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.filterChipText,
                      isSelected && styles.filterChipTextActive,
                      { color: isSelected ? '#ffffff' : isDark ? '#94a3b8' : '#475569' },
                    ]}
                  >
                    {f}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {/* Unit Cards List */}
          <View style={styles.unitsList}>
            {loading && aircons.length === 0 ? (
              <View style={styles.centerStateBox}>
                <ActivityIndicator size="large" color="#10b981" />
                <ThemedText style={styles.loadingText}>Syncing AC controllers from database...</ThemedText>
              </View>
            ) : filteredUnits.length === 0 ? (
              <View
                style={[
                  styles.emptyCard,
                  {
                    backgroundColor: isDark ? '#121826' : '#ffffff',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
                  },
                ]}
              >
                <AppIcon name="aircon" size={44} color="#94a3b8" />
                <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>No AC Controller Devices Found</ThemedText>
                <ThemedText style={styles.emptyDescription}>
                  {search ? 'No AC controller matches your search query.' : 'Tap the button above to register an AC controller.'}
                </ThemedText>
                <Pressable onPress={handleOpenAddModal} style={styles.emptyAddBtn}>
                  <ThemedText style={styles.emptyAddBtnText}>+ Register AC Controller</ThemedText>
                </Pressable>
              </View>
            ) : (
              filteredUnits.map((ac) => {
                const isOnline = ac.status === 'online';
                const isPowerOn = ac.power === 'ON';
                const isTransmitting = transmittingId === ac.deviceId;

                return (
                  <View
                    key={ac.id || ac.deviceId}
                    style={[
                      styles.unitCard,
                      {
                        backgroundColor: isDark ? '#121826' : '#ffffff',
                        borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
                      },
                    ]}
                  >
                    {/* Top Row: Device ID & Status Badges */}
                    <View style={styles.cardTopRow}>
                      <View style={styles.deviceIdBadge}>
                        <ThemedText style={styles.deviceIdText}>{ac.deviceId}</ThemedText>
                        <ThemedText style={styles.deviceNodeText}>• {ac.nodeId}</ThemedText>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View
                          style={[
                            styles.onlineStatusBadge,
                            {
                              backgroundColor: isOnline
                                ? 'rgba(16, 185, 129, 0.15)'
                                : 'rgba(239, 68, 68, 0.15)',
                              borderColor: isOnline ? '#10b981' : '#ef4444',
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.onlineStatusDot,
                              { backgroundColor: isOnline ? '#10b981' : '#ef4444' },
                            ]}
                          />
                          <ThemedText
                            style={[
                              styles.onlineStatusText,
                              { color: isOnline ? '#10b981' : '#ef4444' },
                            ]}
                          >
                            {isOnline ? 'Online' : 'Offline'}
                          </ThemedText>
                        </View>

                        <Pressable
                          onPress={() => handleDeleteDevice(ac)}
                          style={styles.deleteCardBtn}
                          hitSlop={8}
                        >
                          <ThemedText style={styles.deleteCardBtnText}>✕</ThemedText>
                        </Pressable>
                      </View>
                    </View>

                    {/* Unit Name & Identity */}
                    <ThemedText style={[styles.unitNameText, { color: colors.text }]}>
                      {ac.name || ac.deviceId}
                    </ThemedText>

                    {/* Location & Brand Metadata */}
                    <View style={styles.metaRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <AppIcon name="location" size={13} color="#10b981" />
                        <ThemedText style={styles.metaText}>{ac.location || 'Unassigned'}</ThemedText>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <AppIcon name="gear" size={13} color="#94a3b8" />
                        <ThemedText style={styles.metaText}>
                          {[ac.brand, ac.airconType].filter(Boolean).join(' • ') || 'Standard AC Unit'}
                        </ThemedText>
                      </View>
                    </View>

                    {/* Climate Controls Panel */}
                    <View
                      style={[
                        styles.controlsPanel,
                        {
                          backgroundColor: isDark ? 'rgba(0, 0, 0, 0.3)' : '#f8fafc',
                          borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
                        },
                      ]}
                    >
                      {/* Power & Temp Row */}
                      <View style={styles.controlsRow}>
                        {/* Power Toggle Button */}
                        <Pressable
                          onPress={() => handleQuickPowerToggle(ac)}
                          disabled={isTransmitting || !isOnline}
                          style={[
                            styles.powerBtn,
                            isPowerOn ? styles.powerBtnOn : styles.powerBtnOff,
                          ]}
                        >
                          {isTransmitting ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : (
                            <>
                              <AppIcon name="bolt" size={16} color="#ffffff" />
                              <ThemedText style={styles.powerBtnText}>
                                {ac.power === undefined ? 'POWER —' : isPowerOn ? 'POWER ON' : 'POWER OFF'}
                              </ThemedText>
                            </>
                          )}
                        </Pressable>

                        {/* Temperature Control Stepper */}
                        <View style={styles.tempStepperBox}>
                          <Pressable
                            onPress={() => handleAdjustTemp(ac, -1)}
                            style={styles.stepperIconBtn}
                            disabled={!isOnline || !isPowerOn || isTransmitting}
                            hitSlop={6}
                          >
                            <ThemedText style={styles.stepperIconText}>−</ThemedText>
                          </Pressable>

                          <View style={{ alignItems: 'center', minWidth: 54 }}>
                            <ThemedText style={[styles.tempValueText, { color: colors.text }]}>
                              {ac.setTemp == null ? '—' : ac.setTemp + '°C'}
                            </ThemedText>
                            <ThemedText style={styles.tempLabelText}>Set Temp</ThemedText>
                          </View>

                          <Pressable
                            onPress={() => handleAdjustTemp(ac, 1)}
                            style={styles.stepperIconBtn}
                            disabled={!isOnline || !isPowerOn || isTransmitting}
                            hitSlop={6}
                          >
                            <ThemedText style={styles.stepperIconText}>+</ThemedText>
                          </Pressable>
                        </View>
                      </View>

                      {/* Protocol & Mode Badges */}
                      <View style={styles.protocolBadgesRow}>
                        <View style={styles.protocolChip}>
                          <AppIcon name="bolt" size={12} color="#10b981" />
                          <ThemedText style={styles.protocolChipText}>
                            Protocol: {ac.protocol || 'standard'}
                          </ThemedText>
                        </View>

                        <View style={styles.modeChip}>
                          <AppIcon name="snowflake" size={12} color="#06b6d4" />
                          <ThemedText style={styles.modeChipText}>COOL MODE</ThemedText>
                        </View>
                      </View>
                    </View>

                    {/* Card Actions Row */}
                    <View style={styles.cardActionsRow}>
                      <Pressable
                        onPress={() => handleEditDevice(ac)}
                        style={[
                          styles.editBtn,
                          {
                            backgroundColor: isDark ? 'rgba(16, 185, 129, 0.12)' : '#ecfdf5',
                            borderColor: isDark ? 'rgba(16, 185, 129, 0.3)' : '#a7f3d0',
                          },
                        ]}
                      >
                        <AppIcon name="gear" size={14} color="#10b981" />
                        <ThemedText style={styles.editBtnText}>Edit Controller Details</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* Bottom spacer for floating navbar */}
          <View style={{ height: 110 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Floating Bottom Navbar */}
      <FloatingBottomNavbar currentPage="devices" />

      {/* Add / Edit AC Controller Modal */}
      <AddAcControllerModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        initialDevice={selectedDeviceForModal}
        onSaved={async () => {
          await loadAircons(false);
        }}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerLogoContainer: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  headerLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11.5,
    color: '#10b981',
    fontWeight: '700',
    marginTop: 2,
  },
  unitCountBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  unitCountText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#10b981',
  },
  heroRegisterCard: {
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  heroGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  heroLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 10,
  },
  heroIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.2,
  },
  heroDescription: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 3,
    lineHeight: 15,
  },
  heroActionCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroActionPlus: {
    fontSize: 20,
    fontWeight: '800',
    color: '#059669',
    lineHeight: 22,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
    gap: 8,
  },
  searchIcon: {
    width: 16,
    height: 16,
    tintColor: '#10b981',
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  filterChipActive: {},
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  unitsList: {
    gap: 14,
  },
  centerStateBox: {
    paddingVertical: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
  },
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 6,
  },
  emptyDescription: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 260,
  },
  emptyAddBtn: {
    marginTop: 12,
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyAddBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  unitCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  deviceIdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deviceIdText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#10b981',
    letterSpacing: 0.2,
  },
  deviceNodeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#94a3b8',
  },
  onlineStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  onlineStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  onlineStatusText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  deleteCardBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCardBtnText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ef4444',
  },
  unitNameText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  metaRow: {
    gap: 4,
    marginBottom: 12,
  },
  metaText: {
    fontSize: 11.5,
    color: '#94a3b8',
    fontWeight: '600',
  },
  controlsPanel: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  powerBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  powerBtnOn: {
    backgroundColor: '#059669',
  },
  powerBtnOff: {
    backgroundColor: '#475569',
  },
  powerBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.4,
  },
  tempStepperBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  stepperIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperIconText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#10b981',
    lineHeight: 19,
  },
  tempValueText: {
    fontSize: 15,
    fontWeight: '900',
  },
  tempLabelText: {
    fontSize: 9,
    color: '#10b981',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  protocolBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  protocolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  protocolChipText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '700',
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
  },
  modeChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#06b6d4',
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editBtn: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  editBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10b981',
  },
});
