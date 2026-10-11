import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createReadScope, type ReadScope } from '@/services/query-utils';
import { createRefreshCoordinator, type RefreshCoordinator } from '@/services/refresh-coordinator';

import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { AppIcon } from '@/components/app-icon';
import { LocationIcon } from '@/components/location-icon';
import { useSettings } from '@/context/settings-context';
import { CloudHardware } from '@/services/cloud-hardware';
import { resolveWorkerAssignment } from '@/services/supabase';
import { useAuth } from '@/context/auth-context';
import { Spacing } from '@/constants/theme';
import {
  ICON_DEVICES,
  ICON_WIFI,
  ICON_BLUETOOTH,
  ICON_MORE_VERTICAL,
  ICON_SEARCH,
  ICON_ALERT_TRIANGLE,
  ICON_EDIT,
  ICON_EYE,
  ICON_EYE_OFF,
  ICON_LOCATION,
  ICON_REFRESH,
  ICON_BOLT,
} from '@/constants/custom-icons';

import {
  DeviceService,
  BleDeviceService,
  Esp32Device,
  BleDiscoveredDevice,
  WifiNetwork,
  ConnectedPhoneWifi,
  AvailableRoomOption,
  UserDeviceStorage,
} from '@/services/device-service';
import {
  AcControllerService,
  type AcControllerDevice,
  POPULAR_AC_BRANDS,
} from '@/services/ac-controller-service';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type FilterTab = 'all' | 'connected' | 'offline';
type AddStep = 'find' | 'connecting' | 'wifi' | 'verifying' | 'naming' | 'success';
type ReconfigureStep = 'connect' | 'wifi' | 'verifying' | 'success';

const AIRCON_TYPES = [
  'Split Type (Inverter)',
  'Window Type (Inverter)',
  'Cassette Type (Inverter)',
  'Centralized HVAC',
  'Floor Mounted AC',
];

function alertPhoneWifiUnavailable(phone: ConnectedPhoneWifi) {
  const guidance = {
    unsupported: 'Wi-Fi name detection requires an installed app. Type your Wi-Fi name manually here.',
    'location-disabled': 'Turn on Location Services so your phone can reveal its Wi-Fi name, then tap Auto Search again, or type the name manually.',
    'permission-denied': 'Allow EcoTrack foreground location permission in Settings to read your Wi-Fi name, or type the name manually.',
    'precise-location-required': 'Enable Precise Location for EcoTrack in Settings to read your Wi-Fi name, or type the name manually.',
    unavailable: 'Your phone could not provide its Wi-Fi name. Tap Auto Search again, or type the name manually.',
  };
  if (phone.error || phone.isWifi) {
    Alert.alert('Wi-Fi Name Unavailable', phone.error ? guidance[phone.error]
      : 'Your phone is on Wi-Fi but its network name is unavailable. Check location permission and Location Services, or type the name manually.');
  } else {
    Alert.alert('Phone Not Connected to Wi-Fi', "Please connect your phone to your facility's 2.4 GHz Wi-Fi network and tap Auto Search again, or type your Wi-Fi name manually.");
  }
}

function formatBatteryPercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? `${Math.round(value)}%` : 'Unavailable';
}

function formatConnectionLatency(result: { online: boolean; pingMs: number } | null): string {
  return result?.online && Number.isFinite(result.pingMs) && result.pingMs >= 0
    ? `${Math.round(result.pingMs)} ms` : 'Unavailable';
}

export default function DevicesScreen() {
  const { effectiveTheme, colors, triggerHaptic } = useSettings();
  const { userId, userEmail, userName, userType } = useAuth();
  const isDark = effectiveTheme === 'dark';

  // State: Device List & Filtering
  const [devices, setDevices] = useState<Esp32Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const refreshRef = useRef<RefreshCoordinator | null>(null);
  const snapshotUser = useRef<string | null>(null);
  const fetchUser = `${userId}|${userEmail}|${userName}|${userType}`;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [adminShowAll, setAdminShowAll] = useState(true);

  // State: Selected Device Details & Options
  const [selectedDevice, setSelectedDevice] = useState<Esp32Device | null>(null);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [optionsModalVisible, setOptionsModalVisible] = useState(false);
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [roomChangeModalVisible, setRoomChangeModalVisible] = useState(false);
  const [selectedChangeRoomId, setSelectedChangeRoomId] = useState<string | null>(null);
  const [changeRoomSearchQuery, setChangeRoomSearchQuery] = useState('');
  const [changeRoomAirconName, setChangeRoomAirconName] = useState('');
  const [changeRoomAirconBrand, setChangeRoomAirconBrand] = useState('');
  const originalRoomMetadata = useRef({ name: '', brand: '' });
  const [savingRoom, setSavingRoom] = useState(false);
  const roomSavePending = useRef(false);

  // Available Rooms from Supabase for room picker
  const [availableRooms, setAvailableRooms] = useState<AvailableRoomOption[]>([]);

  // State: Test Connection Diagnostics
  const [testingConnection, setTestingConnection] = useState(false);
  const connectionTestRequest = useRef(0);
  const [testResult, setTestResult] = useState<{
    online: boolean;
    pingMs: number;
    wifiSignal: string;
  } | null>(null);

  // State: Add Device Wizard Flow
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addStep, setAddStep] = useState<AddStep>('find');
  const [discoveredDevices, setDiscoveredDevices] = useState<BleDiscoveredDevice[]>([]);
  const [scanningBle, setScanningBle] = useState(false);
  const [targetBleDevice, setTargetBleDevice] = useState<BleDiscoveredDevice | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isManualNodeId, setIsManualNodeId] = useState(false);
  const [manualNodeIdInput, setManualNodeIdInput] = useState('');

  // Wi-Fi Setup Form State
  const [savedWifiNetworks, setSavedWifiNetworks] = useState<WifiNetwork[]>([]);
  const [discoveredWifiNetworks, setDiscoveredWifiNetworks] = useState<WifiNetwork[]>([]);
  const [scanningWifi, setScanningWifi] = useState(false);
  const [selectedWifiSsid, setSelectedWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberWifi, setRememberWifi] = useState(true);

  // Provisioning Progress State
  const [verifyStep, setVerifyStep] = useState(1);
  const [assignedIp, setAssignedIp] = useState('');

  // Naming & Location State
  const [friendlyName, setFriendlyName] = useState('');
  const [customAirconName, setCustomAirconName] = useState('');
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [availableAircons, setAvailableAircons] = useState<AcControllerDevice[]>([]);
  const [registrationNeedsPassword, setRegistrationNeedsPassword] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [selectedAirconType, setSelectedAirconType] = useState('Split Type (Inverter)');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [customBrandInput, setCustomBrandInput] = useState('');
  const [isListeningRemote, setIsListeningRemote] = useState(false);
  const [detectedRemoteInfo, setDetectedRemoteInfo] = useState<{ brand: string; protocol?: string } | null>(null);
  const [sniffError, setSniffError] = useState<string | null>(null);
  const remoteSniffRequest = useRef({ id: 0, listening: false });
  const [savingDevice, setSavingDevice] = useState(false);
  const [newlyCreatedDevice, setNewlyCreatedDevice] = useState<Esp32Device | null>(null);

  // State: Reconfigure Wi-Fi Modal Flow
  const [reconfigModalVisible, setReconfigModalVisible] = useState(false);
  const [reconfigStep, setReconfigStep] = useState<ReconfigureStep>('connect');
  const [reconfigConnecting, setReconfigConnecting] = useState(false);
  const [reconfigError, setReconfigError] = useState<string | null>(null);
  const [reconfigWifiNetworks, setReconfigWifiNetworks] = useState<WifiNetwork[]>([]);
  const [reconfigScanningWifi, setReconfigScanningWifi] = useState(false);
  const [reconfigSelectedSsid, setReconfigSelectedSsid] = useState('');
  const [reconfigWifiPassword, setReconfigWifiPassword] = useState('');
  const [reconfigShowPassword, setReconfigShowPassword] = useState(false);
  const [reconfigVerifyStep, setReconfigVerifyStep] = useState(1);
  const [reconfigAssignedIp, setReconfigAssignedIp] = useState('');

  // Pulse Animation for scanning & live indicators
  const [pulseAnim] = useState(() => new Animated.Value(1));


  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const fetchDevices = useCallback(async (scope: ReadScope) => {
      const [allNodes, userIds1, userIds2, assignment] = await Promise.all([
        DeviceService.getDevices(scope),
        userId ? UserDeviceStorage.getUserNodeIds(userId) : Promise.resolve([]),
        userEmail ? UserDeviceStorage.getUserNodeIds(userEmail) : Promise.resolve([]),
        userType === 'staff' ? resolveWorkerAssignment(userId || userEmail, scope) : Promise.resolve(null),
      ]);

      const localUserNodeIds = Array.from(new Set([...userIds1, ...userIds2]));

      // Filter: only show devices added by THIS logged-in account
      const userDevices = allNodes.filter((device) => {
        // Use the current server-backed room assignment, including desktop-created controllers.
        if (userType === 'staff') return assignment?.isAssigned === true && assignment.roomId === device.roomId;
        // If admin has toggled to inspect all campus nodes
        if (userType === 'admin' && adminShowAll) {
          return true;
        }

        // 1. Direct user ID match
        if (device.addedByUserId && userId && device.addedByUserId === userId) {
          return true;
        }

        // 2. Email match (case-insensitive)
        if (
          device.addedByUserEmail &&
          userEmail &&
          device.addedByUserEmail.trim().toLowerCase() === userEmail.trim().toLowerCase()
        ) {
          return true;
        }

        // 3. Name match (case-insensitive)
        if (
          device.addedByUserName &&
          userName &&
          device.addedByUserName.trim().toLowerCase() === userName.trim().toLowerCase()
        ) {
          return true;
        }

        // 4. Stored local user node ID match
        if (localUserNodeIds.includes(device.id) || localUserNodeIds.includes(device.deviceId)) {
          return true;
        }

        return false;
      });

      return userDevices;
  }, [userId, userEmail, userName, userType, adminShowAll]);

  const refreshDeviceData = useCallback(async (isCurrent: () => boolean) => {
    if (snapshotUser.current !== fetchUser) {
      setLoading(true);
      setDevices([]);
      setAvailableRooms([]);
      setSelectedDevice(null);
      setTestResult(null);
      setTestingConnection(false);
      connectionTestRequest.current += 1;
    }
    const scope = createReadScope();
    try {
      const [userDevices, rooms] = await Promise.all([fetchDevices(scope), DeviceService.fetchAvailableRooms(scope)]);
      scope.assertSuccessful();
      if (!isCurrent()) return;
      snapshotUser.current = fetchUser;
      setDevices(userDevices);
      setAvailableRooms(rooms);
      setSelectedDevice(current => {
        if (!current) return null;
        const fresh = userDevices.find(device => device.id === current.id);
        if (!fresh) return null;
        return Date.parse(current.updated || '') > Date.parse(fresh.updated || '') ? current : fresh;
      });
      setFetchError(null);
    } catch (e) {
      console.error('Failed to load devices:', e);
      if (isCurrent()) setFetchError('Unable to refresh devices. Please try again.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [fetchUser, fetchDevices]);

  const loadDevices = () => refreshRef.current?.refresh() ?? Promise.resolve();
  const loadRooms = loadDevices;

  useEffect(() => {
    const refresh = createRefreshCoordinator(refreshDeviceData);
    refreshRef.current = refresh;
    void refresh.refresh();
    const unsubscribe = DeviceService.subscribeToDeviceChanges(() => refresh.schedule());
    return () => {
      refresh.dispose();
      if (refreshRef.current === refresh) refreshRef.current = null;
      unsubscribe();
    };
  }, [refreshDeviceData]);

  // Filter and Search Logic
  const filteredDevices = devices.filter((device) => {
    const matchesFilter =
      activeFilter === 'all'
        ? true
        : activeFilter === 'connected'
        ? device.status === 'connected'
        : device.status === 'offline';

    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      device.name.toLowerCase().includes(query) ||
      device.deviceId.toLowerCase().includes(query) ||
      (device.room && device.room.toLowerCase().includes(query)) ||
      (device.building && device.building.toLowerCase().includes(query)) ||
      (device.wifiSsid && device.wifiSsid.toLowerCase().includes(query));

    return matchesFilter && matchesSearch;
  });

  const connectedCount = devices.filter((d) => d.status === 'connected').length;
  const offlineCount = devices.filter((d) => d.status === 'offline').length;

  // Room filtering & custom room helpers for Add Device Modal
  const filteredRooms = useMemo(() => {
    const q = roomSearchQuery.trim().toLowerCase();
    if (!q) return availableRooms;
    return availableRooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.buildingName.toLowerCase().includes(q) ||
        r.floorName.toLowerCase().includes(q)
    );
  }, [availableRooms, roomSearchQuery]);

  const isCustomRoomQuery = false; // Cloud registration requires an existing deployment room.

  const selectedRoomDisplayName = useMemo(() => {
    if (!selectedRoomId) return null;
    if (selectedRoomId.startsWith('custom:')) {
      return selectedRoomId.replace(/^custom:/, '');
    }
    const matched = availableRooms.find((r) => r.id === selectedRoomId);
    return matched ? matched.name : null;
  }, [selectedRoomId, availableRooms]);

  const handleRoomSearchChange = (text: string) => {
    setRoomSearchQuery(text);
    const trimmed = text.trim();
    if (!trimmed) {
      setSelectedRoomId(null);
      return;
    }
    const exact = availableRooms.find((r) => r.name.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      setSelectedRoomId(exact.id);
    } else {
      setSelectedRoomId(`custom:${trimmed}`);
    }
  };

  // Room filtering & custom room helpers for Reassign Room Modal
  const filteredChangeRooms = useMemo(() => {
    const q = changeRoomSearchQuery.trim().toLowerCase();
    if (!q) return availableRooms;
    return availableRooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.buildingName.toLowerCase().includes(q) ||
        r.floorName.toLowerCase().includes(q)
    );
  }, [availableRooms, changeRoomSearchQuery]);

  const isCustomChangeRoomQuery = useMemo(() => {
    const trimmed = changeRoomSearchQuery.trim();
    if (!trimmed) return false;
    return !availableRooms.some((r) => r.name.toLowerCase() === trimmed.toLowerCase());
  }, [changeRoomSearchQuery, availableRooms]);

  // Dynamic custom aircon name suggestions
  const airconNameSuggestions = useMemo(() => {
    const currentRoom = selectedRoomDisplayName || (roomSearchQuery.trim() ? roomSearchQuery.trim() : '');
    if (currentRoom) {
      return [
        `${currentRoom} Aircon`,
        `${currentRoom} Split AC`,
        `${currentRoom} AC-1`,
        `${currentRoom} AC-2`,
        `${currentRoom} Inverter AC`,
      ];
    }
    return [];
  }, [selectedRoomDisplayName, roomSearchQuery]);

  // --- Add Device Wizard Handlers ---

  const resetRemoteDetection = () => {
    remoteSniffRequest.current.id += 1;
    remoteSniffRequest.current.listening = false;
    setIsListeningRemote(false);
    setDetectedRemoteInfo(null);
    setSniffError(null);
  };

  const handleCloseAddModal = () => {
    resetRemoteDetection();
    setAddModalVisible(false);
  };

  const handleManualBrandChange = (brand: string) => {
    resetRemoteDetection();
    setSelectedBrand(brand);
  };

  const handleSniffRemote = async () => {
    if (remoteSniffRequest.current.listening) return;
    if (!assignedIp.trim() || assignedIp.trim() === '0.0.0.0') {
      Alert.alert('Device IP Unavailable', 'The controller has not provided a local IP address. Check its Wi-Fi connection, or select your brand manually below.');
      return;
    }
    const requestId = ++remoteSniffRequest.current.id;
    remoteSniffRequest.current.listening = true;
    setIsListeningRemote(true);
    setDetectedRemoteInfo(null);
    setSniffError(null);
    try {
      if (!targetBleDevice?.bleId) throw new Error('Reconnect Bluetooth to this ESP32.');
      const capture = await BleDeviceService.learnNearby(targetBleDevice.bleId, targetBleDevice.deviceId);
      const result = { ...capture, success: true, error: '' };
      if (requestId !== remoteSniffRequest.current.id) return;
      if (result.success && result.brand) {
        triggerHaptic();
        setSelectedBrand(result.brand);
        setCustomBrandInput('');
        setDetectedRemoteInfo({ brand: result.brand, protocol: result.protocol });
      } else {
        setSniffError(`${result.error || 'No remote signal detected.'} Point the remote directly at the ESP32 receiver and press a button, or select your brand manually below. Keep Bluetooth connected to the controller.`);
      }
    } catch {
      if (requestId === remoteSniffRequest.current.id) {
        setSniffError("Unable to read the remote signal. Reconnect Bluetooth and retry, or select your brand manually below.");
      }
    } finally {
      if (requestId === remoteSniffRequest.current.id) {
        remoteSniffRequest.current.listening = false;
        setIsListeningRemote(false);
      }
    }
  };

  useEffect(() => () => { remoteSniffRequest.current.id += 1; }, []);

  const handleStartAddDevice = async () => {
    triggerHaptic();
    resetRemoteDetection();
    setAddStep('find');
    setTargetBleDevice(null);
    setConnectError(null);
    setIsManualNodeId(false);
    setManualNodeIdInput('');
    setSelectedWifiSsid('');
    setWifiPassword('');
    setShowPassword(false);
    setRememberWifi(true);
    setFriendlyName('');
    setCustomAirconName('');
    setAssignmentId(null);
    setAvailableAircons([]);
    setRegistrationNeedsPassword(false);
    setSelectedRoomId(null);
    setRoomSearchQuery('');
    setSelectedAirconType('Split Type (Inverter)');
    setSelectedBrand('');
    setCustomBrandInput('');
    setSavingDevice(false);
    setAddModalVisible(true);

    const saved = await BleDeviceService.getSavedWifiNetworks();
    setSavedWifiNetworks(saved);
    if (saved.length > 0) {
      setSelectedWifiSsid(saved[0].ssid);
    }

    await scanForNearbyBle();
    await loadRooms();
  };

  const scanForNearbyBle = async () => {
    try {
      setScanningBle(true);
      setConnectError(null);
      setDiscoveredDevices([]);
      const nearby = await BleDeviceService.scanNearbyDevices();
      setDiscoveredDevices(nearby);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Bluetooth scan failed. Please retry.');
    } finally {
      setScanningBle(false);
    }
  };

  const handleSelectBleDevice = async (bleDev: BleDiscoveredDevice) => {
    triggerHaptic();
    setTargetBleDevice(bleDev);
    setAddStep('connecting');
    setConnectError(null);

    try {
      const bleId = await BleDeviceService.resolveBleIdentifier(bleDev);
      if (!await BleDeviceService.connectBle(bleId)) throw new Error('Bluetooth connection failed. Ensure the ESP32 is powered on and nearby.');
      const info = await BleDeviceService.readControllerInfo(bleId);
      if (info.cloud_protocol !== 1 || !/^esp32s3-[a-f0-9]{12}$/.test(info.device_id))
        throw new Error('Flash the current EcoTrack cloud controller sketch before registration.');
      setTargetBleDevice({ ...bleDev, deviceId: info.device_id, bleId, macAddress: bleId });
      const status = await CloudHardware.registrationStatus(info);
      const profiles = await AcControllerService.getAllAircons();
      setAvailableAircons(profiles.filter(ac => !ac.nodeId || ac.nodeId === status.node?.id));
      setAssignmentId(status.aircon?.id || null);
      setCustomAirconName(status.aircon?.name || '');
      setFriendlyName(status.node?.name || info.device_id);
      setSelectedRoomId(status.node?.room_id || null);
      setSelectedBrand(status.aircon?.brand || status.node?.brand || '');
      setSelectedAirconType(status.aircon?.aircon_type || 'Split Type (Inverter)');
      if (status.aircon?.protocol_name) setDetectedRemoteInfo({ brand: status.aircon.brand || '', protocol: status.aircon.protocol_name });
      setRegistrationNeedsPassword(status.requires_credentials === true || info.cloud_status === 'unconfigured' || info.cloud_status === 'error');
      if (info.wifi_status === 'connected' && info.ip_address && info.wifi_ssid) {
        setAssignedIp(info.ip_address);
        setSelectedWifiSsid(info.wifi_ssid);
        setAddStep('naming');
        return;
      }
      const saved = await BleDeviceService.getSavedWifiNetworks();
      setSavedWifiNetworks(saved);
      if (saved.length > 0 && !selectedWifiSsid) {
        setSelectedWifiSsid(saved[0].ssid);
      }
      setAddStep('wifi');
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Unable to connect to ESP32-S3 over Bluetooth.');
    }
  };

  const handleScanWifiNetworks = async (forceSelectPhoneWifi: boolean = true, showConnectionAlert: boolean = false) => {
    setScanningWifi(true);
    try {
      const phone = await BleDeviceService.getConnectedPhoneWifi();
      if (forceSelectPhoneWifi && phone.isWifi && phone.ssid) setSelectedWifiSsid(phone.ssid);
      else if (showConnectionAlert && !phone.ssid) alertPhoneWifiUnavailable(phone);
      const networks = await BleDeviceService.scanWifiNetworks(phone);
      setDiscoveredWifiNetworks(networks);
    } catch (err) {
      console.warn('Wi-Fi scan failed:', err);
    } finally {
      setScanningWifi(false);
    }
  };

  const handleScanReconfigWifi = async (forceSelectPhoneWifi: boolean = true, showConnectionAlert: boolean = false) => {
    setReconfigScanningWifi(true);
    try {
      const phone = await BleDeviceService.getConnectedPhoneWifi();
      if (forceSelectPhoneWifi && phone.isWifi && phone.ssid) setReconfigSelectedSsid(phone.ssid);
      else if (showConnectionAlert && !phone.ssid) alertPhoneWifiUnavailable(phone);
      const networks = await BleDeviceService.scanWifiNetworks(phone);
      setReconfigWifiNetworks(networks);
    } catch (err) {
      console.warn('Reconfig Wi-Fi scan failed:', err);
    } finally {
      setReconfigScanningWifi(false);
    }
  };

  useEffect(() => {
    if (addModalVisible && addStep === 'wifi') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Entering this step starts an external Wi-Fi query and its loading indicator.
      handleScanWifiNetworks(true);
    }
  }, [addModalVisible, addStep]);

  useEffect(() => {
    let active = true;
    if (reconfigModalVisible && reconfigStep === 'wifi') {
      void Promise.resolve().then(() => { if (active) return handleScanReconfigWifi(true); });
    }
    return () => { active = false; };
  }, [reconfigModalVisible, reconfigStep]);

  const handleSelectManualNode = (customId: string) => {
    const trimmed = customId.trim();
    if (!trimmed) {
      Alert.alert('Required Field', 'Please enter a Node ID or serial identifier.');
      return;
    }
    const dev: BleDiscoveredDevice = {
      id: trimmed,
      deviceId: trimmed,
      name: trimmed,
      pingMs: null,
      macAddress: '',
      isEcoTrackDevice: true,
    };
    handleSelectBleDevice(dev);
  };

  const handleRemoveSavedWifi = async (ssid: string) => {
    await BleDeviceService.removeSavedWifiSsid(ssid);
    const updated = await BleDeviceService.getSavedWifiNetworks();
    setSavedWifiNetworks(updated);
    if (selectedWifiSsid === ssid) {
      setSelectedWifiSsid(updated.length > 0 ? updated[0].ssid : '');
    }
  };

  const handleConfigureWifi = async () => {
    const targetSsid = selectedWifiSsid.trim();
    if (!targetSsid) {
      Alert.alert('Required Field', 'Please enter your Wi-Fi network SSID.');
      return;
    }
    if (!wifiPassword) {
      Alert.alert('Required Field', 'Please enter your Wi-Fi password.');
      return;
    }
    if (wifiPassword.length < 8) {
      Alert.alert(
        'Short Password',
        'Standard WPA/WPA2 Wi-Fi passwords must be at least 8 characters long. Please check your password.',
        [{ text: 'OK' }]
      );
      return;
    }

    triggerHaptic();
    setConnectError(null);
    setAddStep('verifying');
    setVerifyStep(0);

    try {
      const result = await BleDeviceService.configureWifi(
        targetBleDevice?.bleId || '',
        targetSsid,
        wifiPassword,
        (step) => setVerifyStep(step)
      );

      if (result.success) {
        setConnectError(null);
        setAssignedIp(result.ipAddress);
        setFriendlyName(
          targetBleDevice?.name && !targetBleDevice.name.startsWith('Node')
            ? targetBleDevice.name
            : targetBleDevice?.deviceId
            ? `${targetBleDevice.deviceId} Aircon`
            : 'EcoTrack Aircon Unit'
        );
        setAddStep('naming');
      } else {
        const errorMsg = result.error || 'Wi-Fi connection failed.';
        setConnectError(errorMsg);
        setAddStep('wifi');
        Alert.alert(
          'Wi-Fi Connection Failed',
          `Could not connect ${targetBleDevice?.deviceId || 'node'} to "${targetSsid}".\n\n` +
          '• Please verify that your Wi-Fi password is correct.\n' +
          '• Ensure your Wi-Fi router operates on a 2.4 GHz frequency (5 GHz is not supported).\n' +
          '• Make sure the node is close enough to the router for a stable signal.',
          [{ text: 'Try Again', onPress: () => {} }]
        );
      }
    } catch (e: any) {
      const errorMsg = e?.message || 'Wi-Fi connection failed. Please check the network password.';
      setConnectError(errorMsg);
      setAddStep('wifi');
      Alert.alert(
        'Incorrect Password or Connection Failed',
        `Failed to connect to "${targetSsid}".\n\n` +
        '• Check that the Wi-Fi password was entered accurately.\n' +
        '• Confirm your network is 2.4 GHz.\n' +
        `• Details: ${errorMsg}`,
        [{ text: 'Try Again', onPress: () => {} }]
      );
    }
  };

  const handleSaveNewDevice = async () => {
    if (remoteSniffRequest.current.listening) return;
    if (!friendlyName.trim()) {
      Alert.alert('Required Field', 'Please enter the controller display name.');
      return;
    }
    const effectiveBrand = selectedBrand === '+ Other / Custom'
      ? customBrandInput.trim()
      : (customBrandInput.trim() || selectedBrand.trim());

    if (!effectiveBrand) {
      Alert.alert('Required Field', 'Please custom assign the Air Conditioner brand.');
      return;
    }

    triggerHaptic();
    try {
      setSavingDevice(true);
      const targetSsid = selectedWifiSsid.trim();
      const setup = {
        controller_name: friendlyName.trim(), assignment_mode: assignmentId ? 'existing' as const : 'new' as const,
        aircon_id: assignmentId || undefined, asset_tag: !assignmentId ? customAirconName.trim() : undefined,
        aircon_name: !assignmentId ? customAirconName.trim() : undefined, room_id: selectedRoomId,
        brand: effectiveBrand, aircon_type: selectedAirconType, protocol_name: detectedRemoteInfo?.protocol || 'UNKNOWN',
      };
      if (!targetBleDevice?.bleId) throw new Error('Reconnect Bluetooth to the selected ESP32.');
      if (!assignmentId && !customAirconName.trim()) throw new Error('Enter an air conditioner name or choose an available profile.');
      const created = await DeviceService.registerController(targetBleDevice.bleId, targetBleDevice.deviceId, setup,
        { ssid: targetSsid, pass: wifiPassword });
      await UserDeviceStorage.recordUserNode(userId, created.id);
      await UserDeviceStorage.recordUserNode(userEmail, created.id);
      setWifiPassword('');
      setNewlyCreatedDevice(created);
      await loadDevices();
      setAddStep('success');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save new AC controller device.');
    } finally {
      setSavingDevice(false);
    }
  };

  // --- Reconfigure Wi-Fi Handlers ---

  const handleStartReconfigureWifi = async (device?: Esp32Device) => {
    const target = device || selectedDevice;
    if (!target) return;

    triggerHaptic();
    setSelectedDevice(target);
    setOptionsModalVisible(false);
    setDetailsModalVisible(false);

    setReconfigStep('connect');
    setReconfigError(null);
    setReconfigConnecting(false);
    setReconfigSelectedSsid(target.wifiSsid || '');
    setReconfigWifiPassword('');
    setReconfigShowPassword(false);
    setReconfigVerifyStep(1);
    setReconfigModalVisible(true);

    const saved = await BleDeviceService.getSavedWifiNetworks();
    setReconfigWifiNetworks(saved);
    if (!target.wifiSsid && saved.length > 0) {
      setReconfigSelectedSsid(saved[0].ssid);
    }
  };

  const handleConnectBleForReconfigure = async () => {
    if (!selectedDevice) return;
    triggerHaptic();
    setReconfigConnecting(true);
    setReconfigError(null);

    try {
      const bleId = await BleDeviceService.resolveBleIdentifier(selectedDevice);
      if (!await BleDeviceService.connectBle(bleId)) throw new Error('Bluetooth connection failed. Ensure the ESP32 is powered on and nearby.');
      setSelectedDevice({ ...selectedDevice, macAddress: bleId });
      const saved = await BleDeviceService.getSavedWifiNetworks();
      setReconfigWifiNetworks(saved);
      if (!reconfigSelectedSsid && saved.length > 0) {
        setReconfigSelectedSsid(saved[0].ssid);
      }
      setReconfigStep('wifi');
    } catch (e) {
      setReconfigError(
        e instanceof Error ? e.message : `Unable to connect to ${selectedDevice.name} over Bluetooth.`
      );
    } finally {
      setReconfigConnecting(false);
    }
  };

  const handleApplyReconfigureWifi = async () => {
    const targetSsid = reconfigSelectedSsid.trim();
    if (!targetSsid) {
      Alert.alert('Required Field', 'Please enter your Wi-Fi network SSID.');
      return;
    }
    if (!reconfigWifiPassword) {
      Alert.alert('Required Field', 'Please enter the Wi-Fi network password.');
      return;
    }
    if (reconfigWifiPassword.length < 8) {
      Alert.alert(
        'Short Password',
        'Standard WPA/WPA2 Wi-Fi passwords must be at least 8 characters long. Please verify your password.',
        [{ text: 'OK' }]
      );
      return;
    }

    triggerHaptic();
    setReconfigError(null);
    setReconfigStep('verifying');
    setReconfigVerifyStep(0);

    try {
      const result = await BleDeviceService.configureWifi(
        selectedDevice?.macAddress || '',
        targetSsid,
        reconfigWifiPassword,
        (step) => setReconfigVerifyStep(step)
      );

      if (result.success) {
        setReconfigError(null);
        setReconfigAssignedIp(result.ipAddress);
        if (selectedDevice) {
          const updated = await DeviceService.updateDevice(selectedDevice.id, {
            status: 'connected',
            wifiSsid: targetSsid,
            ...(result.ipAddress ? { ipAddress: result.ipAddress } : {}),
          });
          if (updated) setSelectedDevice(updated);
          await loadDevices();
        }
        setReconfigStep('success');
      } else {
        const errorMsg = result.error || 'Wi-Fi reconfiguration failed.';
        setReconfigError(errorMsg);
        setReconfigStep('wifi');
        Alert.alert(
          'Wi-Fi Reconfiguration Failed',
          `Could not connect to "${targetSsid}".\n\n` +
          '• Please verify that your Wi-Fi password is correct.\n' +
          '• Confirm that the router operates on 2.4 GHz.\n' +
          '• Ensure the device is powered on and within range.',
          [{ text: 'Try Again', onPress: () => {} }]
        );
      }
    } catch (e: any) {
      const errorMsg = e?.message || 'Wi-Fi reconfiguration failed.';
      setReconfigError(errorMsg);
      setReconfigStep('wifi');
      Alert.alert(
        'Incorrect Password or Connection Failed',
        `Failed to reconfigure Wi-Fi for "${targetSsid}".\n\n` +
        '• Please verify your password and try again.\n' +
        `• Details: ${errorMsg}`,
        [{ text: 'Try Again', onPress: () => {} }]
      );
    }
  };

  const handleOpenDetails = (device: Esp32Device) => {
    triggerHaptic();
    connectionTestRequest.current += 1;
    setSelectedDevice(device);
    setTestResult(null);
    setTestingConnection(false);
    setDetailsModalVisible(true);
  };

  const handleOpenOptions = (device: Esp32Device) => {
    triggerHaptic();
    connectionTestRequest.current += 1;
    setSelectedDevice(device);
    setTestResult(null);
    setTestingConnection(false);
    setOptionsModalVisible(true);
  };

  const handleRunConnectionTest = async () => {
    if (!selectedDevice) return;
    triggerHaptic();
    setTestingConnection(true);
    setTestResult(null);
    const requestId = ++connectionTestRequest.current;

    try {
      const res = await BleDeviceService.testDeviceConnection(selectedDevice.id);
      if (requestId === connectionTestRequest.current) setTestResult(res);
    } catch (e) {
      if (requestId === connectionTestRequest.current) Alert.alert('Test Failed', 'Unable to reach AC controller device over the network.');
    } finally {
      if (requestId === connectionTestRequest.current) setTestingConnection(false);
    }
  };

  const handlePromptRename = () => {
    if (!selectedDevice) return;
    setRenameInput(selectedDevice.name);
    setOptionsModalVisible(false);
    setRenameModalVisible(true);
  };

  const handleSaveRename = async () => {
    if (!selectedDevice || !renameInput.trim()) return;
    triggerHaptic();
    try {
      const updated = await DeviceService.updateDevice(selectedDevice.id, { name: renameInput.trim() });
      if (!updated) throw new Error('Rename was not saved.');
      setSelectedDevice(updated);
    } catch {
      Alert.alert('Unable to rename controller', 'The change could not be saved. Please try again.');
      return;
    }
    setRenameModalVisible(false);
    await loadDevices();
  };

  const handlePromptChangeRoom = async () => {
    if (!selectedDevice) return;
    originalRoomMetadata.current = { name: selectedDevice.name || '', brand: selectedDevice.brand || '' };
    setSelectedChangeRoomId(selectedDevice.roomId || null);
    setChangeRoomSearchQuery('');
    setChangeRoomAirconName(selectedDevice.name || '');
    setChangeRoomAirconBrand(selectedDevice.brand || '');
    await loadRooms();
    setOptionsModalVisible(false);
    setDetailsModalVisible(false);
    setRoomChangeModalVisible(true);
  };

  const handleSaveChangeRoom = async () => {
    if (!selectedDevice || roomSavePending.current) return;
    const query = changeRoomSearchQuery.trim();
    const selectedRoom = availableRooms.find(room => room.id === selectedChangeRoomId);
    if (query && selectedChangeRoomId !== `custom:${query}` && selectedRoom?.name.toLowerCase() !== query.toLowerCase()) {
      Alert.alert('Select a room', 'Choose a room from the list or tap the custom room option before updating.');
      return;
    }
    triggerHaptic();
    roomSavePending.current = true;
    setSavingRoom(true);
    try {
      const resolvedRoomId = await DeviceService.resolveRoomId(selectedChangeRoomId);
      const updates: Partial<Esp32Device> = { roomId: resolvedRoomId };
      const name = changeRoomAirconName.trim();
      const brand = changeRoomAirconBrand.trim();
      if (name && name !== originalRoomMetadata.current.name.trim()) updates.name = name;
      if (brand && brand.toLowerCase() !== originalRoomMetadata.current.brand.trim().toLowerCase()) updates.brand = brand;
      const updated = await DeviceService.updateDevice(selectedDevice.id, updates);
      if (!updated) throw new Error('Room change was not saved.');
      setSelectedDevice(updated);
      setDevices(current => current.map(device => device.id === updated.id ? updated : device));
      setTestResult(null);
      connectionTestRequest.current += 1;
      setTestingConnection(false);
      setRoomChangeModalVisible(false);
      await loadDevices();
    } catch {
      Alert.alert('Unable to change room', 'The room change could not be saved. Please try again.');
    } finally {
      roomSavePending.current = false;
      setSavingRoom(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!selectedDevice) return;
    triggerHaptic();
    const removed = await DeviceService.removeDevice(selectedDevice.id, userId || userEmail);
    if (!removed) {
      Alert.alert('Unable to remove controller', 'The controller could not be removed. Please try again.');
      return;
    }
    if (userId) {
      await UserDeviceStorage.removeUserNode(userId, selectedDevice.id);
    }
    if (userEmail) {
      await UserDeviceStorage.removeUserNode(userEmail, selectedDevice.id);
    }
    setRemoveConfirmVisible(false);
    setDetailsModalVisible(false);
    setOptionsModalVisible(false);
    await loadDevices();
  };

  return (
    <LinearGradient
      colors={effectiveTheme === 'dark' ? ['#0b0f19', '#06080e'] : ['#eefbf4', '#f8fafc']}
      style={[styles.container, { backgroundColor: colors.background }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 0.35 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header Bar with EcoTrack Logo */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image
                source={require('@/assets/images/ecoTrack.png')}
                style={styles.headerLogo}
                contentFit="contain"
              />
            <View>
              <ThemedText style={[styles.headerTitle, { color: colors.text }]}>
                Device Management
              </ThemedText>
              <ThemedText style={[styles.headerSubtitle, { color: colors.emerald }]}>
                AC Controller Devices
              </ThemedText>
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Quick Summary Cards */}
          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, isDark ? styles.metricCardDark : styles.metricCardLight]}>
              <ThemedText style={[styles.metricNumber, { color: isDark ? '#f1f5f9' : '#0f172a' }]}>
                {devices.length}
              </ThemedText>
              <ThemedText style={[styles.metricLabel, isDark && { color: '#94a3b8' }]} numberOfLines={2}>
                Total Devices
              </ThemedText>
            </View>
            <View style={[styles.metricCard, isDark ? styles.metricCardDark : styles.metricCardLight]}>
              <View style={styles.metricNumberRow}>
                <View style={[styles.statusDot, { backgroundColor: '#10b981' }]} />
                <ThemedText style={[styles.metricNumber, { color: '#10b981' }]}>{connectedCount}</ThemedText>
              </View>
              <ThemedText style={[styles.metricLabel, isDark && { color: '#94a3b8' }]}>Online</ThemedText>
            </View>
            <View style={[styles.metricCard, isDark ? styles.metricCardDark : styles.metricCardLight]}>
              <View style={styles.metricNumberRow}>
                <View style={[styles.statusDot, { backgroundColor: '#ef4444' }]} />
                <ThemedText style={[styles.metricNumber, { color: '#ef4444' }]}>{offlineCount}</ThemedText>
              </View>
              <ThemedText style={[styles.metricLabel, isDark && { color: '#94a3b8' }]}>Offline</ThemedText>
            </View>
          </View>

          {/* Add AC Controller Button */}
          <Pressable
            onPress={handleStartAddDevice}
            style={({ pressed }) => [
              styles.inlineAddBtn,
              pressed && styles.buttonPressed,
            ]}
          >
            <AppIcon name="devices" size={16} color="#ffffff" />
            <ThemedText style={styles.inlineAddBtnText}>+ Add AC Controller</ThemedText>
          </Pressable>

          {/* Search & Filter Bar */}
          <View style={styles.searchFilterContainer}>
            <View style={[styles.searchBox, isDark ? styles.searchBoxDark : styles.searchBoxLight]}>
              <AppIcon
                name="search"
                size={16}
                color={isDark ? '#94a3b8' : '#64748b'}
                style={styles.searchIcon}
              />
              <TextInput
                style={[styles.searchInput, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
                placeholder="Search AC controller devices..."
                placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                  <ThemedText style={{ color: '#94a3b8', fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                </Pressable>
              )}
            </View>

            {/* Filter Pills */}
            <View style={styles.filterPillsRow}>
              {(['all', 'connected', 'offline'] as const).map((tab) => (
                <Pressable
                  key={tab}
                  onPress={() => {
                    triggerHaptic();
                    setActiveFilter(tab);
                  }}
                  style={[
                    styles.filterPill,
                    isDark ? styles.filterPillDark : styles.filterPillLight,
                    activeFilter === tab && styles.filterPillActive,
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.filterPillText,
                      activeFilter === tab ? styles.filterPillTextActive : (isDark ? styles.filterPillTextDark : styles.filterPillTextLight),
                    ]}
                  >
                    {tab === 'all'
                      ? `All (${devices.length})`
                      : tab === 'connected'
                      ? `Online (${connectedCount})`
                      : `Offline (${offlineCount})`}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {/* AC Controller Devices List Section */}
          <View style={styles.sectionHeader}>
            <ThemedText style={[styles.sectionTitle, isDark ? styles.textEmeraldLight : styles.textEmeraldDark]}>
              {userType === 'admin' && adminShowAll ? 'All Campus AC Controller Devices' : 'AC Controller Devices'}
            </ThemedText>
            {userType === 'admin' && (
              <Pressable
                onPress={() => {
                  triggerHaptic();
                  setAdminShowAll(!adminShowAll);
                }}
                style={[styles.adminToggleBadge, isDark ? styles.adminToggleBadgeDark : styles.adminToggleBadgeLight]}
              >
                <ThemedText style={styles.adminToggleBadgeText}>
                  {adminShowAll ? 'Showing: All Nodes' : 'Showing: My Nodes'}
                </ThemedText>
              </Pressable>
            )}
          </View>

          {fetchError && <Pressable accessibilityRole="button" onPress={() => { void loadDevices(); }} style={{ paddingVertical: 12 }}>
            <ThemedText style={{ color: colors.textSecondary }}>{fetchError} Tap to retry.</ThemedText>
          </Pressable>}
          {loading && devices.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#10b981" />
              <ThemedText style={{ marginTop: 12, color: '#94a3b8' }}>Syncing AC controller devices...</ThemedText>
            </View>
          ) : fetchError && devices.length === 0 ? null : filteredDevices.length === 0 ? (
            /* Empty State */
            <View style={[styles.emptyStateCard, isDark ? styles.emptyCardDark : styles.emptyCardLight]}>
              <View style={styles.emptyIconBadge}>
                <AppIcon name="devices" size={32} color="#10b981" />
              </View>
              <ThemedText style={[styles.emptyTitle, isDark && styles.textWhite]}>
                {searchQuery ? 'No Matching AC Controller Devices' : 'No AC Controller Devices Registered'}
              </ThemedText>
              <ThemedText style={styles.emptyDesc}>
                {searchQuery
                  ? 'Try adjusting your search query or switching the filter tab.'
                  : 'You have not added any AC controller devices to your account yet. Tap "+ Add AC Controller Device" to commission and link your first device.'}
              </ThemedText>
              <Pressable
                onPress={handleStartAddDevice}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.emerald, marginTop: 16, paddingHorizontal: 20 },
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText style={styles.primaryButtonText}>+ Add First AC Controller Device</ThemedText>
              </Pressable>
            </View>
          ) : (
            filteredDevices.map((device) => {
              const isConnected = device.status === 'connected';
              return (
                <View
                  key={device.id}
                  style={[styles.deviceCard, isDark ? styles.deviceCardDark : styles.deviceCardLight]}
                >
                  {/* Card Header */}
                  <View style={styles.deviceCardHeader}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <View style={styles.deviceTitleRow}>
                        <ThemedText style={[styles.deviceName, isDark && styles.textWhite]}>
                          {device.name}
                        </ThemedText>
                        <View style={styles.deviceIdChip}>
                          <ThemedText style={styles.deviceIdChipText}>{device.deviceId}</ThemedText>
                        </View>
                      </View>

                      {/* Location Row */}
                      <View style={styles.deviceLocationRow}>
                        <LocationIcon size={14} color="#10b981" style={styles.locationPinIcon} />
                        <ThemedText style={[styles.deviceLocationText, isDark ? styles.textSlateLight : styles.textSlateDark]} numberOfLines={1}>
                          {[device.building, device.floor, device.room].filter(Boolean).join(' • ') || 'Unassigned Location'}
                        </ThemedText>
                      </View>
                    </View>

                    <Pressable
                      hitSlop={12}
                      onPress={() => handleOpenOptions(device)}
                      style={styles.moreOptionsBtn}
                    >
                      <AppIcon
                        name="more-vertical"
                        size={18}
                        color={isDark ? '#94a3b8' : '#64748b'}
                      />
                    </Pressable>
                  </View>

                  {/* Status & Network Badges */}
                  <View style={styles.deviceMetaRow}>
                    <View
                      style={[
                        styles.statusPill,
                        isConnected ? styles.statusPillOnline : styles.statusPillOffline,
                      ]}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: isConnected ? '#10b981' : '#ef4444' },
                        ]}
                      />
                      <ThemedText
                        style={[
                          styles.statusPillText,
                          { color: isConnected ? '#059669' : '#ef4444' },
                        ]}
                      >
                        {isConnected ? 'Online' : 'Offline'}
                      </ThemedText>
                    </View>

                    {device.wifiSsid && (
                      <View style={styles.wifiBadge}>
                        <AppIcon name="wifi" size={14} color="#059669" />
                        <ThemedText style={styles.wifiBadgeText}>{device.wifiSsid}</ThemedText>
                      </View>
                    )}

                    <ThemedText style={styles.lastSeenText}>Seen: {device.lastSeen}</ThemedText>
                  </View>

                  {/* Card Action Buttons */}
                  <View style={styles.deviceCardFooter}>
                    <ThemedText style={styles.addedDateText}>Added: {device.dateAdded}</ThemedText>
                    <Pressable
                      onPress={() => handleOpenDetails(device)}
                      style={({ pressed }) => [
                        styles.viewDetailsBtn,
                        isDark ? styles.viewDetailsBtnDark : styles.viewDetailsBtnLight,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.viewDetailsBtnText}>View Device</ThemedText>
                      <ThemedText style={{ fontSize: 13, color: '#10b981', fontWeight: '800' }}>→</ThemedText>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}

          {/* Bottom spacer for floating navbar */}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Floating Bottom Navigation Bar */}
        <FloatingBottomNavbar currentPage="devices" />

        {/* ========================================================================= */}
        {/* 1. ADD AC CONTROLLER DEVICE MULTI-STEP MODAL                              */}
        {/* ========================================================================= */}
        <Modal
          visible={addModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={handleCloseAddModal}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
            <View style={[styles.modalContent, isDark ? styles.modalContentDark : styles.modalContentLight]}>
              {/* Modal Header */}
              <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
                <ThemedText style={[styles.modalTitle, isDark && styles.textWhite]}>
                  Add AC Controller Device
                </ThemedText>
                <Pressable hitSlop={12} onPress={handleCloseAddModal}>
                  <ThemedText style={styles.closeModalText}>Cancel</ThemedText>
                </Pressable>
              </View>

              {/* Step Progress Bar */}
              {addStep !== 'success' && (
                <View style={styles.stepProgressBar}>
                  <View style={styles.stepNodesRow}>
                    {(['find', 'connecting', 'wifi', 'verifying', 'naming'] as AddStep[]).map((st, idx) => {
                      const stepNum = idx + 1;
                      const isPassed =
                        (addStep === 'connecting' && idx < 1) ||
                        (addStep === 'wifi' && idx < 2) ||
                        (addStep === 'verifying' && idx < 3) ||
                        (addStep === 'naming' && idx < 4);
                      const isCurrent = addStep === st;

                      return (
                        <React.Fragment key={st}>
                          <View style={styles.stepNodeContainer}>
                            <View
                              style={[
                                styles.stepNodeCircle,
                                isCurrent
                                  ? styles.stepNodeCircleCurrent
                                  : isPassed
                                  ? styles.stepNodeCirclePassed
                                  : isDark
                                  ? styles.stepNodeCircleFutureDark
                                  : styles.stepNodeCircleFutureLight,
                              ]}
                            >
                              <ThemedText
                                style={[
                                  styles.stepNodeText,
                                  isCurrent || isPassed ? styles.textWhite : { color: '#94a3b8' },
                                ]}
                              >
                                {isPassed ? '✓' : stepNum}
                              </ThemedText>
                            </View>
                            <ThemedText style={styles.stepNodeLabel}>
                              {st === 'find'
                                ? 'Find'
                                : st === 'connecting'
                                ? 'BLE'
                                : st === 'wifi'
                                ? 'Wi-Fi'
                                : st === 'verifying'
                                ? 'Verify'
                                : 'Aircon'}
                            </ThemedText>
                          </View>
                          {idx < 4 && (
                            <View
                              style={[
                                styles.stepConnectorLine,
                                isPassed ? styles.stepLineActive : (isDark ? styles.stepLineDark : styles.stepLineLight),
                              ]}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </View>
                </View>
              )}

              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
                {/* STEP 1: FIND DEVICE */}
                {addStep === 'find' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <Animated.View style={[styles.radarCircle, { transform: [{ scale: pulseAnim }] }]}>
                        <AppIcon name="bluetooth" size={28} color="#10b981" />
                      </Animated.View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        Find your ESP32-S3 Node
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        Make sure your EcoTrack ESP32-S3 AC controller device is powered on and Bluetooth is enabled on your phone.
                      </ThemedText>
                    </View>

                    <Pressable
                      onPress={scanForNearbyBle}
                      disabled={scanningBle}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        isDark ? styles.secondaryBtnDark : styles.secondaryBtnLight,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      {scanningBle ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <ActivityIndicator size="small" color="#10b981" />
                          <ThemedText style={{ color: '#10b981', fontWeight: '700' }}>Scanning for ESP32 beacons...</ThemedText>
                        </View>
                      ) : (
                        <ThemedText style={{ color: '#10b981', fontWeight: '700' }}>⟳ Search for BLE Nodes</ThemedText>
                      )}
                    </Pressable>

                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 6 }}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                        Discovered Nodes ({discoveredDevices.length})
                      </ThemedText>
                      <Pressable onPress={() => setIsManualNodeId(!isManualNodeId)} hitSlop={8}>
                        <ThemedText style={{ fontSize: 12, color: '#10b981', fontWeight: '700' }}>
                          {isManualNodeId ? '← Show Discovered' : '+ Enter Node ID'}
                        </ThemedText>
                      </Pressable>
                    </View>

                    {isManualNodeId ? (
                      <View style={[styles.inputGroup, { marginTop: 4 }]}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Enter Node ID / Hardware Identifier
                        </ThemedText>
                        <TextInput
                          style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight]}
                          placeholder="e.g. node-1, node-7, or ESP32-S3-01"
                          placeholderTextColor="#94a3b8"
                          value={manualNodeIdInput}
                          onChangeText={setManualNodeIdInput}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <Pressable
                          onPress={() => handleSelectManualNode(manualNodeIdInput)}
                          style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: colors.emerald, marginTop: 10 },
                            pressed && styles.buttonPressed,
                          ]}
                        >
                          <ThemedText style={styles.primaryButtonText}>Connect to Node</ThemedText>
                        </Pressable>
                      </View>
                    ) : discoveredDevices.length === 0 ? (
                      <View style={[styles.wizardCenterBox, { paddingVertical: 24, marginTop: 8 }]}>
                        <AppIcon name="bluetooth" size={32} color="#10b981" />
                        <ThemedText style={[styles.wizardTitle, { fontSize: 16, marginTop: 10 }, isDark && styles.textWhite]}>
                          No BLE Nodes Detected
                        </ThemedText>
                        <ThemedText style={[styles.wizardSubtitle, { textAlign: 'center', marginHorizontal: 12 }]}>
                          Make sure your ESP32-S3 node is powered on and Bluetooth is enabled on your phone.
                        </ThemedText>
                        <Pressable
                          onPress={() => setIsManualNodeId(true)}
                          style={({ pressed }) => [
                            styles.secondaryButton,
                            isDark ? styles.secondaryBtnDark : styles.secondaryBtnLight,
                            { marginTop: 14, paddingHorizontal: 20 },
                            pressed && styles.buttonPressed,
                          ]}
                        >
                          <ThemedText style={{ color: '#10b981', fontWeight: '700' }}>+ Enter Node ID Manually</ThemedText>
                        </Pressable>
                      </View>
                    ) : (
                      discoveredDevices.map((dev) => (
                        <View
                          key={dev.id}
                          style={[styles.bleCard, isDark ? styles.bleCardDark : styles.bleCardLight]}
                        >
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <ThemedText style={[styles.bleName, isDark && styles.textWhite]}>{dev.name}</ThemedText>
                              <View style={styles.bleChip}>
                                <ThemedText style={styles.bleChipText}>{dev.deviceId}</ThemedText>
                              </View>
                            </View>
                            <ThemedText style={styles.bleMacText}>MAC: {dev.macAddress} • Latency: {dev.pingMs == null ? 'Unavailable' : `${dev.pingMs} ms`}</ThemedText>
                          </View>
                          <Pressable
                            onPress={() => handleSelectBleDevice(dev)}
                            style={({ pressed }) => [
                              styles.bleAddBtn,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <ThemedText style={styles.bleAddBtnText}>Select</ThemedText>
                          </Pressable>
                        </View>
                      ))
                    )}
                  </View>
                )}

                {/* STEP 2: CONNECTING VIA BLE */}
                {addStep === 'connecting' && (
                  <View style={styles.wizardCenterBox}>
                    <ActivityIndicator size="large" color="#10b981" />
                    <ThemedText style={[styles.wizardTitle, { marginTop: 18 }, isDark && styles.textWhite]}>
                      Connecting to {targetBleDevice?.deviceId}...
                    </ThemedText>
                    <ThemedText style={styles.wizardSubtitle}>
                      Establishing Bluetooth GATT handshake. Please keep your phone near the ESP32 node.
                    </ThemedText>

                    {connectError && (
                      <View style={styles.errorBanner}>
                        <AppIcon name="alert" size={18} color="#ef4444" />
                        <ThemedText style={styles.errorText}>{connectError}</ThemedText>
                      </View>
                    )}
                  </View>
                )}

                {/* STEP 3: CONFIGURE WI-FI */}
                {addStep === 'wifi' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <View style={styles.iconCircleEmerald}>
                        <AppIcon name="wifi" size={28} color="#10b981" />
                      </View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        Configure Node Wi-Fi
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        Enter your facility&apos;s 2.4 GHz Wi-Fi credentials for {targetBleDevice?.deviceId} to connect to the network.
                      </ThemedText>
                    </View>

                    {/* Error Banner when connection/password fails */}
                    {connectError && (
                      <View style={[styles.errorBanner, { marginBottom: 14 }]}>
                        <AppIcon name="alert" size={18} color="#ef4444" />
                        <ThemedText style={styles.errorText}>{connectError}</ThemedText>
                      </View>
                    )}

                    {/* Connected phone Wi-Fi and known facility networks */}
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexShrink: 1, minWidth: 0 }}>
                          <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight, { marginBottom: 0 }]} numberOfLines={1}>
                            Known Wi-Fi Networks
                          </ThemedText>
                          {scanningWifi ? (
                            <ActivityIndicator size="small" color="#10b981" style={{ transform: [{ scale: 0.8 }] }} />
                          ) : (
                            discoveredWifiNetworks.length > 0 && (
                              <View style={styles.savedNetMiniBadge}>
                                <ThemedText style={styles.savedNetMiniBadgeText}>{discoveredWifiNetworks.length} Found</ThemedText>
                              </View>
                            )
                          )}
                        </View>
                        <Pressable
                          onPress={() => {
                            triggerHaptic();
                            handleScanWifiNetworks(true, true);
                          }}
                          disabled={scanningWifi}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={({ pressed }) => [
                            styles.rescanWifiBtn,
                            isDark ? styles.rescanWifiBtnDark : styles.rescanWifiBtnLight,
                            scanningWifi && { opacity: 0.6 },
                            pressed && { opacity: 0.75 },
                          ]}
                        >
                          {scanningWifi ? (
                            <ActivityIndicator size="small" color="#10b981" style={{ transform: [{ scale: 0.75 }] }} />
                          ) : (
                            <AppIcon name="refresh" size={13} color="#10b981" />
                          )}
                          <ThemedText style={styles.rescanWifiBtnText}>
                            {scanningWifi ? 'Searching...' : 'Auto Search'}
                          </ThemedText>
                        </Pressable>
                      </View>

                      {/* Auto-searching Progress Banner */}
                      {scanningWifi ? (
                        <View style={[styles.wifiScanningBanner, isDark ? styles.wifiScanningBannerDark : styles.wifiScanningBannerLight]}>
                          <ActivityIndicator size="small" color="#10b981" />
                          <View style={{ flex: 1, gap: 2 }}>
                            <ThemedText style={[styles.wifiScanningTitle, isDark ? styles.textWhite : { color: '#0f172a' }]}>
                              Checking phone Wi-Fi...
                            </ThemedText>
                            <ThemedText style={styles.wifiScanningSubtitle}>
                              Reading the connected phone network and saved facility profiles
                            </ThemedText>
                          </View>
                        </View>
                      ) : discoveredWifiNetworks.length > 0 ? (
                        <View style={styles.discoveredWifiList}>
                          {discoveredWifiNetworks.map((net) => {
                            const isSelected = selectedWifiSsid.toLowerCase().trim() === net.ssid.toLowerCase().trim();
                            return (
                              <Pressable
                                key={net.ssid}
                                onPress={() => {
                                  triggerHaptic();
                                  setSelectedWifiSsid(net.ssid);
                                }}
                                style={({ pressed }) => [
                                  styles.wifiItemCard,
                                  isDark ? styles.wifiItemCardDark : styles.wifiItemCardLight,
                                  isSelected && (isDark ? styles.wifiItemCardActiveDark : styles.wifiItemCardActiveLight),
                                  pressed && { opacity: 0.85 },
                                ]}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                                  <View style={[
                                    styles.wifiSignalIconCircle,
                                    isSelected
                                      ? { backgroundColor: 'rgba(16, 185, 129, 0.2)' }
                                      : (isDark ? { backgroundColor: 'rgba(255, 255, 255, 0.05)' } : { backgroundColor: '#f1f5f9' }),
                                  ]}>
                                    <AppIcon
                                      name="wifi"
                                      size={16}
                                      color={isSelected ? '#10b981' : isDark ? '#94a3b8' : '#64748b'}
                                    />
                                  </View>

                                  <View style={{ flex: 1, gap: 2 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <ThemedText
                                        style={[
                                          styles.wifiItemSsid,
                                          isDark && styles.textWhite,
                                          isSelected && { color: '#10b981', fontWeight: '800' },
                                        ]}
                                        numberOfLines={1}
                                      >
                                        {net.ssid}
                                      </ThemedText>
                                      {net.isConnectedPhone ? (
                                        <View style={styles.savedNetMiniBadge}>
                                          <ThemedText style={styles.savedNetMiniBadgeText}>Connected Phone Wi-Fi</ThemedText>
                                        </View>
                                      ) : net.isSaved ? (
                                        <View style={styles.savedNetMiniBadge}>
                                          <ThemedText style={styles.savedNetMiniBadgeText}>Saved</ThemedText>
                                        </View>
                                      ) : (
                                        <View style={[styles.savedNetMiniBadge, { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.2)' : '#eff6ff' }]}>
                                          <ThemedText style={[styles.savedNetMiniBadgeText, { color: '#3b82f6' }]}>Registered Network</ThemedText>
                                        </View>
                                      )}
                                    </View>
                                    <ThemedText style={styles.wifiItemMeta}>
                                      {net.isConnectedPhone ? `${net.frequency || 'Band unknown'} • Controller requires 2.4 GHz` : 'Known network • Confirm availability and 2.4 GHz'}
                                    </ThemedText>
                                  </View>
                                </View>

                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <View style={[
                                    styles.wifiRadioBadge,
                                    isSelected && { backgroundColor: '#10b981', borderColor: '#10b981' },
                                    isDark && !isSelected && { borderColor: '#475569' },
                                  ]}>
                                    {isSelected ? (
                                      <ThemedText style={{ color: '#ffffff', fontSize: 11, fontWeight: '900' }}>✓</ThemedText>
                                    ) : null}
                                  </View>
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <View style={[styles.wifiEmptyCard, isDark ? styles.wifiEmptyCardDark : styles.wifiEmptyCardLight]}>
                          <View style={styles.wifiEmptyIconCircle}>
                            <AppIcon name="wifi" size={18} color="#10b981" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.wifiEmptyTitle, isDark && styles.textWhite]}>
                              No connected or known Wi-Fi names found
                            </ThemedText>
                            <ThemedText style={styles.wifiEmptySubtitle}>
                              Connect your phone to Wi-Fi and tap &quot;Auto Search&quot;, or enter the network name below.
                            </ThemedText>
                          </View>
                        </View>
                      )}
                    </View>

                    {/* Wi-Fi SSID Input */}
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Wi-Fi Network Name (SSID) *
                        </ThemedText>
                        <View style={styles.wifiFreqBadge}>
                          <ThemedText style={styles.wifiFreqBadgeText}>2.4 GHz Only</ThemedText>
                        </View>
                      </View>
                      <View style={[styles.wifiInputRow, isDark ? styles.inputFieldDark : styles.inputFieldLight]}>
                        <AppIcon
                          name="wifi"
                          size={18}
                          color={isDark ? '#94a3b8' : '#64748b'}
                          style={{ marginRight: 8 }}
                        />
                        <TextInput
                          style={[styles.flexInput, { color: isDark ? '#f1f5f9' : '#0f172a' }]}
                          placeholder="Enter 2.4 GHz Wi-Fi Network Name"
                          placeholderTextColor="#94a3b8"
                          value={selectedWifiSsid}
                          onChangeText={setSelectedWifiSsid}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        {selectedWifiSsid ? (
                          <Pressable onPress={() => setSelectedWifiSsid('')} hitSlop={8} style={{ padding: 4 }}>
                            <ThemedText style={{ color: '#94a3b8', fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                          </Pressable>
                        ) : null}
                      </View>

                      {/* Quick Presets Row below Input */}
                      {(discoveredWifiNetworks.some(net => net.isConnectedPhone) || savedWifiNetworks.length > 0) && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <ThemedText style={[styles.quickPresetLabel, isDark && styles.textSlateLight]}>Quick Presets:</ThemedText>
                        {Array.from(new Set([...discoveredWifiNetworks.filter(net => net.isConnectedPhone).map(net => net.ssid), ...savedWifiNetworks.map(s => s.ssid)])).map((preset) => {
                          const isSelected = selectedWifiSsid === preset;
                          return (
                            <Pressable
                              key={preset}
                              onPress={() => {
                                triggerHaptic();
                                setSelectedWifiSsid(preset);
                              }}
                              style={[
                                styles.presetChip,
                                isDark ? styles.presetChipDark : styles.presetChipLight,
                                isSelected && styles.presetChipActive,
                              ]}
                            >
                              <ThemedText style={[styles.presetChipText, isSelected && styles.presetChipTextActive]}>
                                {isSelected ? '✓ ' : ''}{preset}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                      )}
                    </View>

                    {/* Saved Facility Networks (if any previously saved) */}
                    {savedWifiNetworks.length > 0 && (
                      <View style={[styles.inputGroup, { marginTop: 12 }]}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Saved Facility Networks
                        </ThemedText>
                        <View style={styles.savedNetworksRow}>
                          {savedWifiNetworks.map((net) => {
                            const isSelected = selectedWifiSsid === net.ssid;
                            return (
                              <Pressable
                                key={net.ssid}
                                onPress={() => setSelectedWifiSsid(net.ssid)}
                                style={[
                                  styles.savedNetworkChip,
                                  isDark ? styles.savedNetworkChipDark : styles.savedNetworkChipLight,
                                  isSelected && styles.savedNetworkChipActive,
                                ]}
                              >
                                <AppIcon
                                  name="wifi"
                                  size={13}
                                  color={isSelected ? '#10b981' : isDark ? '#94a3b8' : '#64748b'}
                                />
                                <ThemedText
                                  style={[
                                    styles.savedNetworkChipText,
                                    isSelected && { color: '#10b981', fontWeight: '800' },
                                    isDark && !isSelected && styles.textWhite,
                                  ]}
                                >
                                  {net.ssid}
                                </ThemedText>
                                <Pressable
                                  onPress={() => handleRemoveSavedWifi(net.ssid)}
                                  hitSlop={6}
                                  style={styles.removeSavedNetBtn}
                                >
                                  <ThemedText style={{ color: '#94a3b8', fontSize: 10, fontWeight: '800' }}>✕</ThemedText>
                                </Pressable>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}

                    {/* Password Input */}
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                        Wi-Fi Password *
                      </ThemedText>
                      <View style={[styles.passwordRow, isDark ? styles.passwordRowDark : styles.passwordRowLight]}>
                        <TextInput
                          style={[styles.passwordInput, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
                          placeholder="Enter Wi-Fi Password"
                          placeholderTextColor="#94a3b8"
                          secureTextEntry={!showPassword}
                          value={wifiPassword}
                          onChangeText={setWifiPassword}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10} style={{ padding: 4 }}>
                          <AppIcon
                            name={showPassword ? 'eye-off' : 'eye'}
                            size={20}
                            color={isDark ? '#94a3b8' : '#64748b'}
                          />
                        </Pressable>
                      </View>
                    </View>

                    {/* Remember network option */}
                    <Pressable
                      onPress={() => setRememberWifi(!rememberWifi)}
                      style={styles.rememberRow}
                    >
                      <View
                        style={[
                          styles.rememberCheckbox,
                          {
                            borderColor: rememberWifi ? '#10b981' : isDark ? '#475569' : '#cbd5e1',
                            backgroundColor: rememberWifi ? '#10b981' : 'transparent',
                          },
                        ]}
                      >
                        {rememberWifi && <ThemedText style={{ color: '#ffffff', fontSize: 11, fontWeight: '900' }}>✓</ThemedText>}
                      </View>
                      <ThemedText style={[styles.rememberText, isDark ? styles.textSlateLight : styles.textSlateDark]}>
                        Remember this network for future AC nodes
                      </ThemedText>
                    </Pressable>

                    {/* Technical Notice Callout */}
                    <View style={[styles.wifiNoticeBox, isDark ? styles.wifiNoticeBoxDark : styles.wifiNoticeBoxLight]}>
                      <AppIcon name="bolt" size={14} color={isDark ? '#fbbf24' : '#d97706'} />
                      <ThemedText style={[styles.wifiNoticeText, isDark ? styles.textSlateLight : styles.textSlateDark]}>
                        EcoTrack ESP32-S3 AC controller devices require a standard 2.4 GHz Wi-Fi access point. 5 GHz frequencies are not supported by the hardware antenna.
                      </ThemedText>
                    </View>

                    <Pressable
                      onPress={handleConfigureWifi}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.emerald, marginTop: 18 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.primaryButtonText}>Provision Wi-Fi Credentials</ThemedText>
                    </Pressable>
                  </View>
                )}

                {/* STEP 4: VERIFYING CONNECTION */}
                {addStep === 'verifying' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <ActivityIndicator size="large" color="#10b981" />
                      <ThemedText style={[styles.wizardTitle, { marginTop: 14 }, isDark && styles.textWhite]}>
                        Connecting ESP32 to Wi-Fi
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        {targetBleDevice?.deviceId}
                      </ThemedText>
                    </View>

                    {/* Live Verification Checklist */}
                    <View style={[styles.checklistCard, isDark ? styles.checklistCardDark : styles.checklistCardLight]}>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: verifyStep >= 1 ? '#10b981' : '#94a3b8', fontWeight: '800' }}>
                          {verifyStep >= 1 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, verifyStep >= 1 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          ESP32 Bluetooth connection confirmed
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: verifyStep >= 2 ? '#10b981' : '#94a3b8', fontWeight: '800' }}>
                          {verifyStep >= 2 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, verifyStep >= 2 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Wi-Fi credentials transmitted
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: verifyStep >= 3 ? '#10b981' : '#94a3b8', fontWeight: '800' }}>
                          {verifyStep >= 3 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, verifyStep >= 3 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          DHCP handshake & IP assigned ({assignedIp})
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: verifyStep >= 4 ? '#10b981' : '#94a3b8', fontWeight: '800' }}>
                          {verifyStep >= 4 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, verifyStep >= 4 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Network profile saved; backend access unverified
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                )}

                {/* STEP 5: CUSTOM AIRCON NAME & ASSIGN ROOM */}
                {addStep === 'naming' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <View style={styles.iconCircleEmerald}>
                        <AppIcon name="edit" size={24} color="#10b981" />
                      </View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        Aircon & Node Registration
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        Name the controller, choose its air conditioner, and verify the cloud connection.
                      </ThemedText>
                    </View>

                    <View style={styles.inputGroup}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>Node ID / Hardware</ThemedText>
                      <View style={[styles.readOnlyInput, isDark ? styles.readOnlyInputDark : styles.readOnlyInputLight]}>
                        <ThemedText style={{ fontWeight: '700', color: '#10b981' }}>{targetBleDevice?.deviceId || 'ESP32-S3'}</ThemedText>
                        <ThemedText style={{ fontSize: 11, color: '#94a3b8' }}>IP: {assignedIp}</ThemedText>
                      </View>
                    </View>

                    {registrationNeedsPassword && (
                      <View style={styles.inputGroup}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>Current Wi-Fi password for cloud registration</ThemedText>
                        <TextInput style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight]}
                          value={wifiPassword} onChangeText={setWifiPassword} secureTextEntry autoCapitalize="none"
                          placeholder="Enter the connected Wi-Fi password" placeholderTextColor="#94a3b8" />
                      </View>
                    )}
                    <View style={styles.inputGroup}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>Available air conditioner</ThemedText>
                      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
                        <Pressable accessibilityRole="radio" accessibilityState={{ selected: !assignmentId }} style={[styles.airconPill, isDark ? styles.airconPillDark : styles.airconPillLight, !assignmentId && styles.airconPillActive]} onPress={() => { if (assignmentId) { setAssignmentId(null); setCustomAirconName(''); } }}>
                          <ThemedText style={[styles.airconPillText, !assignmentId && { color: '#ffffff' }]}>{!assignmentId ? '✓ ' : ''}Add custom air conditioner name</ThemedText>
                        </Pressable>
                        {availableAircons.map(ac => (
                          <Pressable key={ac.id} accessibilityRole="radio" accessibilityState={{ selected: assignmentId === ac.id }} style={[styles.airconPill, isDark ? styles.airconPillDark : styles.airconPillLight, assignmentId === ac.id && styles.airconPillActive]} onPress={() => {
                            setAssignmentId(ac.id); setCustomAirconName(ac.airconName || ac.deviceId);
                            setSelectedBrand(ac.brand || ''); setSelectedAirconType(ac.airconType || 'Split Type (Inverter)');
                            setSelectedRoomId(ac.roomId || null);
                            setDetectedRemoteInfo({ brand: ac.brand || '', protocol: ac.protocolName || ac.protocol });
                          }}>
                            <ThemedText style={[styles.airconPillText, assignmentId === ac.id && { color: '#ffffff' }]}>{assignmentId === ac.id ? '✓ ' : ''}{ac.airconName || ac.deviceId}</ThemedText>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Controller Display Name <ThemedText style={{ color: '#ef4444' }}>*</ThemedText>
                        </ThemedText>
                        <View style={styles.customBadgePill}>
                          <ThemedText style={styles.customBadgeText}>Custom Name</ThemedText>
                        </View>
                      </View>
                      <View style={[styles.customNameInputRow, isDark ? styles.inputFieldDark : styles.inputFieldLight]}>
                        <AppIcon
                          name="edit"
                          size={16}
                          color="#10b981"
                          style={{ marginRight: 8 }}
                        />
                        <TextInput
                          style={[styles.flexInput, { color: isDark ? '#f1f5f9' : '#0f172a', fontWeight: '700' }]}
                          placeholder="e.g. Lab 204 Aircon, Daikin Split AC, Unit 1"
                          placeholderTextColor="#94a3b8"
                          value={friendlyName}
                          onChangeText={setFriendlyName}
                          autoCorrect={false}
                        />
                        {friendlyName.length > 0 && (
                          <Pressable onPress={() => setFriendlyName('')} hitSlop={8} style={{ padding: 4 }}>
                            <ThemedText style={{ color: '#94a3b8', fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                          </Pressable>
                        )}
                      </View>

                      {/* Quick Aircon Name Suggestions */}
                      <View style={{ marginTop: 6 }}>
                        <ThemedText style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: '600', marginBottom: 4 }}>
                          Quick Suggestions:
                        </ThemedText>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                          {airconNameSuggestions.map((sug) => {
                            const isMatch = friendlyName.trim().toLowerCase() === sug.trim().toLowerCase();
                            return (
                              <Pressable
                                key={sug}
                                onPress={() => {
                                  triggerHaptic();
                                  setFriendlyName(sug);
                                }}
                                style={[
                                  styles.nameSugPill,
                                  isDark ? styles.nameSugPillDark : styles.nameSugPillLight,
                                  isMatch && styles.nameSugPillActive,
                                ]}
                              >
                                <ThemedText
                                  style={[
                                    styles.nameSugPillText,
                                    isMatch && { color: '#10b981', fontWeight: '800' },
                                    isDark && !isMatch && styles.textWhite,
                                  ]}
                                >
                                  {sug}
                                </ThemedText>
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      </View>
                    </View>

                    <View style={[styles.inputGroup, {
                      marginTop: 14, padding: 14, borderRadius: 14, borderWidth: 1,
                      backgroundColor: isDark ? '#062015' : '#f0fdf4',
                      borderColor: isDark ? '#064e3b' : '#bbf7d0',
                    }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <AppIcon name="aircon" size={20} color="#10b981" />
                        <ThemedText style={[styles.inputLabel, isDark && styles.textWhite, { flex: 1, marginBottom: 0 }]}>
                          Auto-Detect Brand with Remote
                        </ThemedText>
                      </View>
                      <ThemedText style={{ fontSize: 12, color: isDark ? '#cbd5e1' : '#475569', marginTop: 8 }}>
                        Point your physical AC remote directly at the ESP32 receiver and press any button (Power, Temp, Mode).
                      </ThemedText>
                      <Pressable
                        onPress={handleSniffRemote}
                        disabled={isListeningRemote}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: isListeningRemote, busy: isListeningRemote }}
                        style={({ pressed }) => [
                          styles.primaryButton,
                          { backgroundColor: colors.emerald, marginTop: 12, flexDirection: 'row', gap: 8 },
                          isListeningRemote && { opacity: 0.65 },
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        {isListeningRemote && <ActivityIndicator size="small" color="#ffffff" />}
                        <ThemedText style={[styles.primaryButtonText, { flexShrink: 1 }]}>
                          {isListeningRemote ? 'Listening for remote pulses...' : sniffError ? 'Retry' : detectedRemoteInfo ? 'Re-scan' : 'Listen for Remote Signal'}
                        </ThemedText>
                      </Pressable>
                      <ThemedText style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b', marginTop: 6 }}>
                        {isListeningRemote ? 'Press a button on your AC remote now!' : '6-second listening window'}
                      </ThemedText>
                      {detectedRemoteInfo && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
                          <AppIcon name="check-circle" size={16} color="#10b981" />
                          <ThemedText style={{ flex: 1, fontSize: 12, fontWeight: '700', color: isDark ? '#34d399' : '#047857' }}>
                            Auto-Detected: {detectedRemoteInfo.brand}
                          </ThemedText>
                        </View>
                      )}
                      {sniffError && (
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10 }}>
                          <AppIcon name="alert" size={16} color={isDark ? '#fbbf24' : '#b45309'} />
                          <ThemedText style={{ flex: 1, fontSize: 12, color: isDark ? '#fbbf24' : '#92400e' }}>{sniffError}</ThemedText>
                        </View>
                      )}
                    </View>

                    {/* Air Conditioner Brand Input & Quick Presets (Custom Assign Form) */}
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Custom Aircon Brand <ThemedText style={{ color: '#ef4444' }}>*</ThemedText>
                        </ThemedText>
                        <ThemedText style={{ fontSize: 10.5, color: '#10b981', fontWeight: '700' }}>
                          Custom Assign
                        </ThemedText>
                      </View>
                      {selectedBrand.trim() ? (
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
                            Custom Assigned: {selectedBrand.trim()} {selectedAirconType ? `(${selectedAirconType})` : ''}
                          </ThemedText>
                        </View>
                      ) : null}
                      <TextInput
                        style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight]}
                        placeholder="Custom assign brand (e.g. Daikin, Carrier, Koppel, Midea)..."
                        placeholderTextColor="#94a3b8"
                        value={selectedBrand}
                        onChangeText={handleManualBrandChange}
                      />
                      <ThemedText style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, marginBottom: 2, fontWeight: '600' }}>
                        Quick Presets:
                      </ThemedText>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', marginTop: 4 }}>
                        {['Daikin', 'Carrier', 'Koppel', 'Panasonic', 'LG', 'Mitsubishi', 'Samsung', 'Midea', 'Gree', 'Condura', 'Haier', 'TCL', 'Sharp'].map((b) => {
                          const isSel = selectedBrand.trim().toLowerCase() === b.toLowerCase();
                          return (
                            <Pressable
                              key={b}
                              onPress={() => {
                                triggerHaptic();
                                handleManualBrandChange(b);
                              }}
                              style={[
                                styles.airconPill,
                                isDark ? styles.airconPillDark : styles.airconPillLight,
                                isSel && styles.airconPillActive,
                              ]}
                            >
                              <ThemedText style={[styles.airconPillText, isSel && { color: '#ffffff', fontWeight: '700' }, isDark && !isSel && styles.textWhite]}>
                                {b}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>

                    {/* Aircon Type Input & Quick Presets */}
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Aircon Type / Model
                        </ThemedText>
                        <ThemedText style={{ fontSize: 10.5, color: '#10b981', fontWeight: '700' }}>
                          Editable Preset
                        </ThemedText>
                      </View>
                      <TextInput
                        style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight]}
                        placeholder="Type custom aircon type or select preset below..."
                        placeholderTextColor="#94a3b8"
                        value={selectedAirconType}
                        onChangeText={setSelectedAirconType}
                      />
                      <ThemedText style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, marginBottom: 2, fontWeight: '600' }}>
                        Quick Presets:
                      </ThemedText>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', marginTop: 4 }}>
                        {AIRCON_TYPES.map((type) => {
                          const isSel = selectedAirconType.trim().toLowerCase() === type.trim().toLowerCase();
                          return (
                            <Pressable
                              key={type}
                              onPress={() => {
                                triggerHaptic();
                                setSelectedAirconType(type);
                              }}
                              style={[
                                styles.airconPill,
                                isDark ? styles.airconPillDark : styles.airconPillLight,
                                isSel && styles.airconPillActive,
                              ]}
                            >
                              <ThemedText style={[styles.airconPillText, isSel && { color: '#ffffff', fontWeight: '700' }, isDark && !isSel && styles.textWhite]}>
                                {type}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                        <Pressable
                          onPress={() => {
                            triggerHaptic();
                            setSelectedAirconType('');
                          }}
                          style={[
                            styles.airconPill,
                            isDark ? styles.airconPillDark : styles.airconPillLight,
                            !AIRCON_TYPES.some((t) => t.toLowerCase() === selectedAirconType.trim().toLowerCase()) && selectedAirconType.trim().length > 0 && styles.airconPillActive,
                            { borderStyle: 'dashed' },
                          ]}
                        >
                          <ThemedText style={[styles.airconPillText, { color: '#10b981', fontWeight: '800' }]}>
                            + Custom Type
                          </ThemedText>
                        </Pressable>
                      </ScrollView>
                    </View>

                    {/* Room Assignment Picker with Search & Custom Room Typing */}
                    <View style={[styles.inputGroup, { marginTop: 16 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <LocationIcon size={14} color="#10b981" />
                          <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                            Assign to Room
                          </ThemedText>
                        </View>
                        {selectedRoomDisplayName && (
                          <ThemedText style={{ fontSize: 11, color: '#10b981', fontWeight: '700', maxWidth: 160 }} numberOfLines={1}>
                            Selected: {selectedRoomDisplayName}
                          </ThemedText>
                        )}
                      </View>

                      {/* Type / Search Room Input */}
                      <View style={[styles.searchBox, isDark ? styles.searchBoxDark : styles.searchBoxLight, { paddingVertical: 8, marginBottom: 8 }]}>
                        <AppIcon
                          name="search"
                          size={16}
                          color={isDark ? '#94a3b8' : '#64748b'}
                          style={styles.searchIcon}
                        />
                        <TextInput
                          style={[styles.searchInput, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
                          placeholder="Type room name or search..."
                          placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                          value={roomSearchQuery}
                          onChangeText={handleRoomSearchChange}
                        />
                        {roomSearchQuery.length > 0 && (
                          <Pressable
                            onPress={() => {
                              triggerHaptic();
                              setRoomSearchQuery('');
                              setSelectedRoomId(null);
                            }}
                            hitSlop={8}
                          >
                            <ThemedText style={{ color: '#94a3b8', fontSize: 13, fontWeight: '700', paddingHorizontal: 4 }}>✕</ThemedText>
                          </Pressable>
                        )}
                      </View>

                      {/* Room Options List */}
                      <View style={{ maxHeight: 220 }}>
                        <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                          {/* Option to assign to custom typed room */}
                          {isCustomRoomQuery && (
                            <Pressable
                              onPress={() => {
                                triggerHaptic();
                                setSelectedRoomId(`custom:${roomSearchQuery.trim()}`);
                              }}
                              style={[
                                styles.roomOptionItem,
                                isDark ? styles.roomOptionDark : styles.roomOptionLight,
                                selectedRoomId === `custom:${roomSearchQuery.trim()}` && styles.roomOptionActive,
                                { borderColor: '#10b981', borderStyle: 'dashed', borderWidth: 1.5 },
                              ]}
                            >
                              <View style={{ flex: 1 }}>
                                <ThemedText style={[styles.roomOptionText, { color: '#10b981', fontWeight: '800' }]}>
                              + Assign to &quot;{roomSearchQuery.trim()}&quot;
                                </ThemedText>
                                <ThemedText style={styles.roomOptionSubText}>
                                  Custom room location
                                </ThemedText>
                              </View>
                              {selectedRoomId === `custom:${roomSearchQuery.trim()}` && (
                                <ThemedText style={{ color: '#10b981', fontWeight: '800' }}>✓</ThemedText>
                              )}
                            </Pressable>
                          )}

                          {/* Unassigned Option */}
                          {(!roomSearchQuery || 'unassigned'.includes(roomSearchQuery.toLowerCase())) && (
                            <Pressable
                              onPress={() => {
                                triggerHaptic();
                                setSelectedRoomId(null);
                                setRoomSearchQuery('');
                              }}
                              style={[
                                styles.roomOptionItem,
                                isDark ? styles.roomOptionDark : styles.roomOptionLight,
                                selectedRoomId === null && styles.roomOptionActive,
                              ]}
                            >
                              <ThemedText style={[styles.roomOptionText, selectedRoomId === null && { color: '#10b981', fontWeight: '800' }, isDark && selectedRoomId !== null && styles.textWhite]}>
                                — Unassigned (Assign Later) —
                              </ThemedText>
                              {selectedRoomId === null && (
                                <ThemedText style={{ color: '#10b981', fontWeight: '800' }}>✓</ThemedText>
                              )}
                            </Pressable>
                          )}

                          {/* Filtered Rooms */}
                          {filteredRooms.map((room) => {
                            const isSel = selectedRoomId === room.id;
                            return (
                              <Pressable
                                key={room.id}
                                onPress={() => {
                                  triggerHaptic();
                                  setSelectedRoomId(room.id);
                                  setRoomSearchQuery(room.name);
                                  // Aircon brand is NOT auto-assigned - must be custom assigned by the user
                                  if (room.airconType && !selectedAirconType) {
                                    setSelectedAirconType(room.airconType);
                                  }
                                  if (!friendlyName.trim()) {
                                    setCustomAirconName(room.airconName || `${room.name} Aircon`);
                                  }
                                }}
                                style={[
                                  styles.roomOptionItem,
                                  isDark ? styles.roomOptionDark : styles.roomOptionLight,
                                  isSel && styles.roomOptionActive,
                                ]}
                              >
                                <View style={{ flex: 1, gap: 3 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 }}>
                                    <ThemedText style={[styles.roomOptionText, isSel && { color: '#10b981', fontWeight: '800' }, isDark && !isSel && styles.textWhite]}>
                                      {room.name}
                                    </ThemedText>
                                    {room.airconBrand ? (
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: isDark ? 'rgba(16, 185, 129, 0.18)' : '#d1fae5', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: isDark ? 'rgba(16, 185, 129, 0.4)' : '#a7f3d0' }}>
                                        <AppIcon name="bolt" size={10} color={isDark ? '#34d399' : '#059669'} />
                                        <ThemedText style={{ fontSize: 10.5, fontWeight: '800', color: isDark ? '#34d399' : '#047857' }}>
                                          {room.airconBrand}
                                        </ThemedText>
                                      </View>
                                    ) : null}
                                  </View>
                                  <ThemedText style={styles.roomOptionSubText}>
                                    {room.buildingName} • {room.floorName}
                                    {room.airconType ? ` • ${room.airconType}` : ''}
                                    {room.nodeName ? ` • Node: ${room.nodeName}` : ''}
                                  </ThemedText>
                                </View>
                                {isSel && (
                                  <ThemedText style={{ color: '#10b981', fontWeight: '800', fontSize: 16 }}>✓</ThemedText>
                                )}
                              </Pressable>
                            );
                          })}

                          {filteredRooms.length === 0 && !isCustomRoomQuery && (
                            <ThemedText style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, paddingVertical: 12 }}>
                              No matching rooms found.
                            </ThemedText>
                          )}
                        </ScrollView>
                      </View>

                      {/* Inline Custom Aircon Name & Brand for Selected Room */}
                      <View style={{ marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: isDark ? '#062016' : '#ecfdf5', borderWidth: 1.2, borderColor: isDark ? '#064e3b' : '#a7f3d0' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <AppIcon name="bolt" size={13} color="#10b981" />
                            <ThemedText style={{ fontSize: 11.5, fontWeight: '800', color: isDark ? '#34d399' : '#059669' }}>
                              Aircon Assignment & Custom Name
                            </ThemedText>
                          </View>
                          {selectedRoomDisplayName && (
                            <ThemedText style={{ fontSize: 10.5, color: '#10b981', fontWeight: '700' }}>
                              Auto-Bound: {selectedRoomDisplayName}
                            </ThemedText>
                          )}
                        </View>

                        {/* Custom Name Input */}
                        <ThemedText style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#475569', marginBottom: 4, fontWeight: '600' }}>
                          Custom Aircon Name:
                        </ThemedText>
                        <TextInput
                          style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight, { fontSize: 13, paddingVertical: 8, marginBottom: 10 }]}
                          placeholder="e.g. Lab 4 Daikin Inverter AC"
                          placeholderTextColor="#94a3b8"
                          value={customAirconName}
                          onChangeText={setCustomAirconName}
                          editable={!assignmentId}
                        />

                        {/* Custom Aircon Brand Input for this room */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <ThemedText style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#475569', fontWeight: '600' }}>
                            Custom Aircon Brand:
                          </ThemedText>
                          <ThemedText style={{ fontSize: 10.5, color: '#10b981', fontWeight: '700' }}>
                            {selectedBrand ? `Custom: ${selectedBrand}` : 'Type / Select Brand'}
                          </ThemedText>
                        </View>
                        <TextInput
                          style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight, { fontSize: 13, paddingVertical: 8, marginBottom: 8 }]}
                          placeholder="Custom assign brand (e.g. Daikin, Carrier, Koppel)..."
                          placeholderTextColor="#94a3b8"
                          value={selectedBrand}
                          onChangeText={handleManualBrandChange}
                        />

                        {/* Quick Brand Switcher Pills */}
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                          {['Daikin', 'Carrier', 'Koppel', 'Panasonic', 'LG', 'Mitsubishi', 'Samsung', 'Midea', 'Gree', 'Condura'].map((b) => {
                            const isBrandSel = selectedBrand.trim().toLowerCase() === b.toLowerCase();
                            return (
                              <Pressable
                                key={b}
                                onPress={() => {
                                  triggerHaptic();
                                  handleManualBrandChange(b);
                                }}
                                style={[
                                  styles.airconPill,
                                  isDark ? styles.airconPillDark : styles.airconPillLight,
                                  isBrandSel && styles.airconPillActive,
                                  { paddingVertical: 4, paddingHorizontal: 10, marginEnd: 6 },
                                ]}
                              >
                                <ThemedText style={[styles.airconPillText, { fontSize: 11 }, isBrandSel && { color: '#ffffff', fontWeight: '800' }]}>
                                  {b}
                                </ThemedText>
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      </View>
                    </View>

                    <Pressable
                      onPress={handleSaveNewDevice}
                      disabled={savingDevice || isListeningRemote}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.emerald, marginTop: 22 },
                        isListeningRemote && { opacity: 0.5 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      {savingDevice ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <ThemedText style={styles.primaryButtonText}>Save & Verify Controller</ThemedText>
                      )}
                    </Pressable>
                  </View>
                )}

                {/* STEP 6: SUCCESS */}
                {addStep === 'success' && (
                  <View style={styles.wizardCenterBox}>
                    <View style={styles.successBadgeCircle}>
                      <ThemedText style={{ fontSize: 32, color: '#ffffff', fontWeight: '900' }}>✓</ThemedText>
                    </View>
                    <ThemedText style={[styles.wizardTitle, { marginTop: 16 }, isDark && styles.textWhite]}>
                      Aircon Registered Successfully
                    </ThemedText>
                    <ThemedText style={styles.wizardSubtitle}>
                      {newlyCreatedDevice?.name} ({newlyCreatedDevice?.deviceId})
                    </ThemedText>

                    {/* Summary card */}
                    <View style={[styles.successSummaryBox, isDark ? styles.successBoxDark : styles.successBoxLight]}>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Aircon Brand</ThemedText>
                        <ThemedText style={[styles.summaryValue, { color: '#10b981', fontWeight: '800' }]}>
                          {selectedBrand.trim() || 'Custom Brand'}
                        </ThemedText>
                      </View>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Aircon Name</ThemedText>
                        <ThemedText style={[styles.summaryValue, isDark ? styles.textWhite : { color: '#0f172a' }]} numberOfLines={1}>
                          {newlyCreatedDevice?.name}
                        </ThemedText>
                      </View>

                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Node ID</ThemedText>
                        <View style={[styles.idBadge, isDark ? styles.idBadgeDark : styles.idBadgeLight]}>
                          <ThemedText style={styles.idBadgeText} numberOfLines={1}>
                            {newlyCreatedDevice?.id || targetBleDevice?.deviceId || 'ESP32-Node'}
                          </ThemedText>
                        </View>
                      </View>

                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Status</ThemedText>
                        <View style={styles.statusSuccessPill}>
                          <View style={styles.statusSuccessDot} />
                          <ThemedText style={styles.statusSuccessText}>Online / Active</ThemedText>
                        </View>
                      </View>

                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Aircon Type</ThemedText>
                        <ThemedText style={[styles.summaryValue, isDark ? styles.textWhite : { color: '#0f172a' }]} numberOfLines={1}>
                          {newlyCreatedDevice?.airconType || selectedAirconType || 'Split Type (Inverter)'}
                        </ThemedText>
                      </View>

                      <View style={[styles.summaryDivider, isDark ? styles.summaryDividerDark : styles.summaryDividerLight]} />

                      {/* Room Assignment with dedicated card & icon */}
                      <View style={styles.summaryLocationSection}>
                        <ThemedText style={styles.summaryLabel}>Room Assignment</ThemedText>
                        <View style={[styles.summaryLocationCard, isDark ? styles.summaryLocationCardDark : styles.summaryLocationCardLight]}>
                          <View style={styles.summaryLocationIconCircle}>
                            <LocationIcon size={14} color="#10b981" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.summaryRoomTitle, isDark && styles.textWhite]}>
                              {newlyCreatedDevice?.room || '— Unassigned (Assign Later) —'}
                            </ThemedText>
                            {(newlyCreatedDevice?.building || newlyCreatedDevice?.floor) && (
                              <ThemedText style={styles.summaryLocationSubtitle} numberOfLines={2}>
                                {[newlyCreatedDevice?.building, newlyCreatedDevice?.floor].filter(Boolean).join(' • ')}
                              </ThemedText>
                            )}
                          </View>
                        </View>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => {
                        handleCloseAddModal();
                        if (newlyCreatedDevice) {
                          handleOpenDetails(newlyCreatedDevice);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.emerald, width: '100%', marginTop: 20 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.primaryButtonText}>View Device Details</ThemedText>
                    </Pressable>

                    <Pressable
                      onPress={handleCloseAddModal}
                      style={styles.textLinkBtn}
                    >
                      <ThemedText style={styles.textLinkBtnText}>Done</ThemedText>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ========================================================================= */}
        {/* 2. DEVICE DETAILS BOTTOM SHEET MODAL                                      */}
        {/* ========================================================================= */}
        <Modal
          visible={detailsModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setDetailsModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalContent, isDark ? styles.modalContentDark : styles.modalContentLight]}>
              <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <ThemedText style={[styles.modalTitle, isDark && styles.textWhite]}>
                    {selectedDevice?.name}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: selectedDevice?.status === 'connected' ? '#10b981' : '#ef4444', fontWeight: '700' }}>
                    {selectedDevice?.deviceId} • {selectedDevice?.status === 'connected' ? '● Online' : '● Offline'}
                  </ThemedText>
                </View>
                <Pressable hitSlop={12} onPress={() => setDetailsModalVisible(false)}>
                  <ThemedText style={styles.closeModalText}>Close</ThemedText>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
                {/* 1. HARDWARE CONFIGURATION (Matching Desktop Admin) */}
                <ThemedText style={[styles.sectionTitle, isDark ? styles.textEmeraldLight : styles.textEmeraldDark, { marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase' }]}>
                  Hardware Configuration
                </ThemedText>

                <View style={[styles.infoList, isDark ? styles.infoListDark : styles.infoListLight]}>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Status</ThemedText>
                    <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selectedDevice?.status === 'connected' ? '#10b981' : '#ef4444' }} />
                      <ThemedText style={[styles.infoVal, { flex: 0, color: selectedDevice?.status === 'connected' ? '#10b981' : '#ef4444', fontWeight: '800' }]}>
                        {selectedDevice?.status === 'connected' ? 'Online' : 'Offline'}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>AC Controller Model</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite, { fontWeight: '700' }]}>
                      {selectedDevice?.firmwareVersion || (selectedDevice as any)?.model || '—'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>ESP32 Serial</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {selectedDevice?.macAddress || selectedDevice?.deviceId || selectedDevice?.id || '—'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Battery Level</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {formatBatteryPercent(selectedDevice?.battery)}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Available Offline Slots</ThemedText>
                    <ThemedText style={[styles.infoVal, { color: '#10b981', fontWeight: '700' }]}>
                      {(selectedDevice as any)?.offlineSlots || '—'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Connection Latency</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {testingConnection ? 'Checking…' : formatConnectionLatency(testResult)}
                    </ThemedText>
                  </View>
                </View>

                {/* 2. DEVICE CONFIGURATION (Matching Desktop Admin) */}
                <ThemedText style={[styles.sectionTitle, isDark ? styles.textEmeraldLight : styles.textEmeraldDark, { marginTop: 16, letterSpacing: 0.5, textTransform: 'uppercase' }]}>
                  Device Configuration
                </ThemedText>

                <View style={[styles.infoList, isDark ? styles.infoListDark : styles.infoListLight]}>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Associated AC</ThemedText>
                    <ThemedText style={[styles.infoVal, { color: '#10b981', fontWeight: '800' }]}>
                      {selectedDevice?.brand ? `${selectedDevice.brand} ${selectedDevice?.airconType || ''}`.trim() : (selectedDevice?.associatedAc || '—')}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Aircon Type</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {selectedDevice?.airconType || '—'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Assigned Room</ThemedText>
                    <ThemedText style={[styles.infoVal, { color: '#10b981', fontWeight: '700' }]}>
                      {[selectedDevice?.building, selectedDevice?.floor, selectedDevice?.room].filter(Boolean).join(' • ') || (selectedDevice?.roomId ? 'Room details unavailable' : 'Unassigned')}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Rule / Daily Schedule</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                      {selectedDevice?.wakeTime && selectedDevice?.sleepTime ? `${selectedDevice.wakeTime} - ${selectedDevice.sleepTime}` : '—'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>PIR / Occupancy</ThemedText>
                    <ThemedText style={[styles.infoVal, { color: '#10b981', fontWeight: '800' }]}>
                      {(selectedDevice as any)?.pirOccupancy || '—'}
                    </ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Database Node ID</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>{selectedDevice?.id}</ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <ThemedText style={styles.infoKey}>Date Installed</ThemedText>
                    <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>{selectedDevice?.dateAdded}</ThemedText>
                  </View>
                </View>

                {/* Connection Diagnostics Test Result */}
                {testResult && (
                  <View style={[styles.testResultBox, isDark ? styles.testBoxDark : styles.testBoxLight, !testResult.online && { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
                    <ThemedText style={{ fontWeight: '800', color: testResult.online ? '#10b981' : '#ef4444', fontSize: 13 }}>
                      {testResult.online ? '✓ Local Controller Reached' : '✕ Local Controller Unreachable'}
                    </ThemedText>
                    <ThemedText style={{ fontSize: 12, color: isDark ? '#cbd5e1' : '#475569', marginTop: 4 }}>
                      {testResult.online ? `Latency: ${formatConnectionLatency(testResult)} • Device identity verified` : 'The controller could not be reached or its identity could not be verified. Latency is unavailable.'}
                    </ThemedText>
                  </View>
                )}

                {/* Actions Section */}
                <ThemedText style={[styles.sectionTitle, isDark ? styles.textEmeraldLight : styles.textEmeraldDark, { marginTop: 16 }]}>
                  Device Actions
                </ThemedText>

                <View style={styles.actionsColumn}>
                  <Pressable
                    onPress={handleRunConnectionTest}
                    disabled={testingConnection}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      isDark ? styles.actionBtnDark : styles.actionBtnLight,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    {testingConnection ? (
                      <ActivityIndicator size="small" color="#10b981" />
                    ) : (
                      <ThemedText style={{ color: '#10b981', fontWeight: '800', fontSize: 13.5 }}>
                        Test Live Connection
                      </ThemedText>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={handlePromptRename}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      isDark ? styles.actionBtnDark : styles.actionBtnLight,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={{ color: isDark ? '#ffffff' : '#1e293b', fontWeight: '700', fontSize: 13.5 }}>
                      Rename Aircon Unit
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={handlePromptChangeRoom}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      isDark ? styles.actionBtnDark : styles.actionBtnLight,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={{ color: isDark ? '#ffffff' : '#1e293b', fontWeight: '700', fontSize: 13.5 }}>
                      Reassign Room Location
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      if (selectedDevice) {
                        handleStartReconfigureWifi(selectedDevice);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      isDark ? styles.actionBtnDark : styles.actionBtnLight,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={{ color: isDark ? '#ffffff' : '#1e293b', fontWeight: '700', fontSize: 13.5 }}>
                      Reconfigure Wi-Fi
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => setRemoveConfirmVisible(true)}
                    style={({ pressed }) => [
                      styles.actionBtnDestructive,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText style={{ color: '#ef4444', fontWeight: '800', fontSize: 13.5 }}>
                      Remove Node
                    </ThemedText>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* 3. DEVICE OPTIONS (3-DOT) MODAL                                           */}
        {/* ========================================================================= */}
        <Modal
          visible={optionsModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setOptionsModalVisible(false)}
        >
          <Pressable
            style={styles.optionsBackdrop}
            onPress={() => setOptionsModalVisible(false)}
          >
            <View style={[styles.optionsPopup, isDark ? styles.optionsPopupDark : styles.optionsPopupLight]}>
              <ThemedText style={[styles.optionsPopupTitle, isDark && styles.textWhite]}>
                Node Options
              </ThemedText>

              <Pressable
                onPress={() => {
                  setOptionsModalVisible(false);
                  if (selectedDevice) handleOpenDetails(selectedDevice);
                }}
                style={styles.optionRow}
              >
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>View Details</ThemedText>
              </Pressable>

              <Pressable onPress={handlePromptRename} style={styles.optionRow}>
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>Rename Aircon Unit</ThemedText>
              </Pressable>

              <Pressable onPress={handlePromptChangeRoom} style={styles.optionRow}>
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>Change Room Assignment</ThemedText>
              </Pressable>

              <Pressable
                onPress={() => {
                  if (selectedDevice) {
                    handleStartReconfigureWifi(selectedDevice);
                  }
                }}
                style={styles.optionRow}
              >
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>Reconfigure Wi-Fi</ThemedText>
              </Pressable>

              <Pressable
                onPress={() => {
                  setOptionsModalVisible(false);
                  if (selectedDevice) {
                    handleOpenDetails(selectedDevice);
                    handleRunConnectionTest();
                  }
                }}
                style={styles.optionRow}
              >
                <ThemedText style={[styles.optionRowText, isDark && styles.textWhite]}>Test Connection</ThemedText>
              </Pressable>

              <Pressable
                onPress={() => {
                  setOptionsModalVisible(false);
                  setRemoveConfirmVisible(true);
                }}
                style={[styles.optionRow, { borderBottomWidth: 0 }]}
              >
                <ThemedText style={[styles.optionRowText, { color: '#ef4444', fontWeight: '800' }]}>
                  Remove Node
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

        {/* ========================================================================= */}
        {/* 3.5. RECONFIGURE WI-FI MODAL                                              */}
        {/* ========================================================================= */}
        <Modal
          visible={reconfigModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setReconfigModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalContent, isDark ? styles.modalContentDark : styles.modalContentLight]}>
              {/* Modal Header */}
              <View style={[styles.modalHeader, isDark && styles.modalHeaderDark]}>
                <View>
                  <ThemedText style={[styles.modalTitle, isDark && styles.textWhite]}>
                    Reconfigure Wi-Fi
                  </ThemedText>
                  <ThemedText style={{ fontSize: 12, color: '#10b981', fontWeight: '700' }}>
                    {selectedDevice?.name} ({selectedDevice?.deviceId})
                  </ThemedText>
                </View>
                <Pressable hitSlop={12} onPress={() => setReconfigModalVisible(false)}>
                  <ThemedText style={styles.closeModalText}>Cancel</ThemedText>
                </Pressable>
              </View>

              {/* Step Progress Bar */}
              {reconfigStep !== 'success' && (
                <View style={styles.stepProgressBar}>
                  <View style={styles.stepNodesRow}>
                    {(['connect', 'wifi', 'verifying'] as ReconfigureStep[]).map((st, idx) => {
                      const stepNum = idx + 1;
                      const isPassed =
                        (reconfigStep === 'wifi' && idx < 1) ||
                        (reconfigStep === 'verifying' && idx < 2);
                      const isCurrent = reconfigStep === st;

                      return (
                        <React.Fragment key={st}>
                          <View style={styles.stepNodeContainer}>
                            <View
                              style={[
                                styles.stepNodeCircle,
                                isCurrent
                                  ? styles.stepNodeCircleCurrent
                                  : isPassed
                                  ? styles.stepNodeCirclePassed
                                  : isDark
                                  ? styles.stepNodeCircleFutureDark
                                  : styles.stepNodeCircleFutureLight,
                              ]}
                            >
                              <ThemedText
                                style={[
                                  styles.stepNodeText,
                                  isCurrent || isPassed ? styles.textWhite : { color: '#94a3b8' },
                                ]}
                              >
                                {isPassed ? '✓' : stepNum}
                              </ThemedText>
                            </View>
                            <ThemedText style={styles.stepNodeLabel}>
                              {st === 'connect'
                                ? 'Bluetooth'
                                : st === 'wifi'
                                ? 'Wi-Fi'
                                : 'Verify'}
                            </ThemedText>
                          </View>
                          {idx < 2 && (
                            <View
                              style={[
                                styles.stepConnectorLine,
                                isPassed ? styles.stepLineActive : (isDark ? styles.stepLineDark : styles.stepLineLight),
                              ]}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </View>
                </View>
              )}

              <ScrollView contentContainerStyle={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
                {/* STEP 1: BLUETOOTH CONNECT */}
                {reconfigStep === 'connect' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <Animated.View style={[styles.radarCircle, { transform: [{ scale: pulseAnim }] }]}>
                        <AppIcon
                          name="bluetooth"
                          size={28}
                          color="#10b981"
                        />
                      </Animated.View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        Connect to Node
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        Pair with {selectedDevice?.name} ({selectedDevice?.deviceId}) over Bluetooth to update Wi-Fi settings.
                      </ThemedText>
                    </View>

                    {/* Device Info Overview Card */}
                    <View style={[styles.infoList, isDark ? styles.infoListDark : styles.infoListLight, { marginTop: 12 }]}>
                      <View style={styles.infoRow}>
                        <ThemedText style={styles.infoKey}>Target Device</ThemedText>
                        <ThemedText style={[styles.infoVal, { color: '#10b981', fontWeight: '800' }]}>
                          {selectedDevice?.name}
                        </ThemedText>
                      </View>
                      <View style={styles.infoRow}>
                        <ThemedText style={styles.infoKey}>Device ID</ThemedText>
                        <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                          {selectedDevice?.deviceId}
                        </ThemedText>
                      </View>
                      <View style={styles.infoRow}>
                        <ThemedText style={styles.infoKey}>Current Wi-Fi</ThemedText>
                        <ThemedText style={[styles.infoVal, isDark && styles.textWhite]}>
                          {selectedDevice?.wifiSsid || 'Disconnected'}
                        </ThemedText>
                      </View>
                    </View>

                    {reconfigError && (
                      <View style={[styles.errorBanner, { marginTop: 14 }]}>
                        <AppIcon
                          name="alert"
                          size={18}
                          color="#ef4444"
                        />
                        <ThemedText style={styles.errorText}>{reconfigError}</ThemedText>
                      </View>
                    )}

                    <Pressable
                      onPress={handleConnectBleForReconfigure}
                      disabled={reconfigConnecting}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.emerald, marginTop: 22 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      {reconfigConnecting ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <ActivityIndicator size="small" color="#ffffff" />
                          <ThemedText style={styles.primaryButtonText}>Connecting to {selectedDevice?.deviceId}...</ThemedText>
                        </View>
                      ) : (
                        <ThemedText style={styles.primaryButtonText}>Connect to Node</ThemedText>
                      )}
                    </Pressable>
                  </View>
                )}

                {/* STEP 2: SELECT WI-FI NETWORK */}
                {reconfigStep === 'wifi' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <View style={styles.iconCircleEmerald}>
                        <AppIcon
                          name="wifi"
                          size={28}
                          color="#10b981"
                        />
                      </View>
                      <ThemedText style={[styles.wizardTitle, isDark && styles.textWhite]}>
                        Select New Wi-Fi Network
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        Choose network for {selectedDevice?.name}.
                      </ThemedText>
                    </View>

                    {/* Error Banner when connection/password fails */}
                    {reconfigError && (
                      <View style={[styles.errorBanner, { marginBottom: 14 }]}>
                        <AppIcon name="alert" size={18} color="#ef4444" />
                        <ThemedText style={styles.errorText}>{reconfigError}</ThemedText>
                      </View>
                    )}

                    {/* AUTO-SEARCHED WI-FI NETWORKS (Reconfigure) */}
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexShrink: 1, minWidth: 0 }}>
                          <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight, { marginBottom: 0 }]} numberOfLines={1}>
                            Known Wi-Fi Networks
                          </ThemedText>
                          {reconfigScanningWifi ? (
                            <ActivityIndicator size="small" color="#10b981" style={{ transform: [{ scale: 0.8 }] }} />
                          ) : (
                            reconfigWifiNetworks.length > 0 && (
                              <View style={styles.savedNetMiniBadge}>
                                <ThemedText style={styles.savedNetMiniBadgeText}>{reconfigWifiNetworks.length} Found</ThemedText>
                              </View>
                            )
                          )}
                        </View>
                        <Pressable
                          onPress={() => {
                            triggerHaptic();
                            handleScanReconfigWifi(true, true);
                          }}
                          disabled={reconfigScanningWifi}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={({ pressed }) => [
                            styles.rescanWifiBtn,
                            isDark ? styles.rescanWifiBtnDark : styles.rescanWifiBtnLight,
                            reconfigScanningWifi && { opacity: 0.6 },
                            pressed && { opacity: 0.75 },
                          ]}
                        >
                          {reconfigScanningWifi ? (
                            <ActivityIndicator size="small" color="#10b981" style={{ transform: [{ scale: 0.75 }] }} />
                          ) : (
                            <AppIcon name="refresh" size={13} color="#10b981" />
                          )}
                          <ThemedText style={styles.rescanWifiBtnText}>
                            {reconfigScanningWifi ? 'Searching...' : 'Auto Search'}
                          </ThemedText>
                        </Pressable>
                      </View>

                      {/* Auto-searching Progress Banner */}
                      {reconfigScanningWifi ? (
                        <View style={[styles.wifiScanningBanner, isDark ? styles.wifiScanningBannerDark : styles.wifiScanningBannerLight]}>
                          <ActivityIndicator size="small" color="#10b981" />
                          <View style={{ flex: 1, gap: 2 }}>
                            <ThemedText style={[styles.wifiScanningTitle, isDark ? styles.textWhite : { color: '#0f172a' }]}>
                              Checking phone Wi-Fi...
                            </ThemedText>
                            <ThemedText style={styles.wifiScanningSubtitle}>
                              Reading the connected phone network and saved facility profiles
                            </ThemedText>
                          </View>
                        </View>
                      ) : reconfigWifiNetworks.length > 0 ? (
                        <View style={styles.discoveredWifiList}>
                          {reconfigWifiNetworks.map((net) => {
                            const isSelected = reconfigSelectedSsid.toLowerCase().trim() === net.ssid.toLowerCase().trim();
                            return (
                              <Pressable
                                key={net.ssid}
                                onPress={() => {
                                  triggerHaptic();
                                  setReconfigSelectedSsid(net.ssid);
                                }}
                                style={({ pressed }) => [
                                  styles.wifiItemCard,
                                  isDark ? styles.wifiItemCardDark : styles.wifiItemCardLight,
                                  isSelected && (isDark ? styles.wifiItemCardActiveDark : styles.wifiItemCardActiveLight),
                                  pressed && { opacity: 0.85 },
                                ]}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                                  <View style={[
                                    styles.wifiSignalIconCircle,
                                    isSelected
                                      ? { backgroundColor: 'rgba(16, 185, 129, 0.2)' }
                                      : (isDark ? { backgroundColor: 'rgba(255, 255, 255, 0.05)' } : { backgroundColor: '#f1f5f9' }),
                                  ]}>
                                    <AppIcon
                                      name="wifi"
                                      size={16}
                                      color={isSelected ? '#10b981' : isDark ? '#94a3b8' : '#64748b'}
                                    />
                                  </View>

                                  <View style={{ flex: 1, gap: 2 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <ThemedText
                                        style={[
                                          styles.wifiItemSsid,
                                          isDark && styles.textWhite,
                                          isSelected && { color: '#10b981', fontWeight: '800' },
                                        ]}
                                        numberOfLines={1}
                                      >
                                        {net.ssid}
                                      </ThemedText>
                                      {net.isConnectedPhone ? (
                                        <View style={styles.savedNetMiniBadge}>
                                          <ThemedText style={styles.savedNetMiniBadgeText}>Connected Phone Wi-Fi</ThemedText>
                                        </View>
                                      ) : net.isSaved ? (
                                        <View style={styles.savedNetMiniBadge}>
                                          <ThemedText style={styles.savedNetMiniBadgeText}>Saved</ThemedText>
                                        </View>
                                      ) : (
                                        <View style={[styles.savedNetMiniBadge, { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.2)' : '#eff6ff' }]}>
                                          <ThemedText style={[styles.savedNetMiniBadgeText, { color: '#3b82f6' }]}>Registered Network</ThemedText>
                                        </View>
                                      )}
                                    </View>
                                    <ThemedText style={styles.wifiItemMeta}>
                                      {net.isConnectedPhone ? `${net.frequency || 'Band unknown'} • Controller requires 2.4 GHz` : 'Known network • Confirm availability and 2.4 GHz'}
                                    </ThemedText>
                                  </View>
                                </View>

                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <View style={[
                                    styles.wifiRadioBadge,
                                    isSelected && { backgroundColor: '#10b981', borderColor: '#10b981' },
                                    isDark && !isSelected && { borderColor: '#475569' },
                                  ]}>
                                    {isSelected ? (
                                      <ThemedText style={{ color: '#ffffff', fontSize: 11, fontWeight: '900' }}>✓</ThemedText>
                                    ) : null}
                                  </View>
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <View style={[styles.wifiEmptyCard, isDark ? styles.wifiEmptyCardDark : styles.wifiEmptyCardLight]}>
                          <View style={styles.wifiEmptyIconCircle}>
                            <AppIcon name="wifi" size={18} color="#10b981" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.wifiEmptyTitle, isDark && styles.textWhite]}>
                              No connected or known Wi-Fi names found
                            </ThemedText>
                            <ThemedText style={styles.wifiEmptySubtitle}>
                              Connect your phone to Wi-Fi and tap &quot;Auto Search&quot;, or enter the network name below.
                            </ThemedText>
                          </View>
                        </View>
                      )}
                    </View>

                    {/* Wi-Fi SSID Input */}
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Wi-Fi Network Name (SSID) *
                        </ThemedText>
                        <View style={styles.wifiFreqBadge}>
                          <ThemedText style={styles.wifiFreqBadgeText}>2.4 GHz Only</ThemedText>
                        </View>
                      </View>
                      <View style={[styles.wifiInputRow, isDark ? styles.inputFieldDark : styles.inputFieldLight]}>
                        <AppIcon
                          name="wifi"
                          size={18}
                          color={isDark ? '#94a3b8' : '#64748b'}
                          style={{ marginRight: 8 }}
                        />
                        <TextInput
                          style={[styles.flexInput, { color: isDark ? '#f1f5f9' : '#0f172a' }]}
                          placeholder="Enter 2.4 GHz Wi-Fi Network Name"
                          placeholderTextColor="#94a3b8"
                          value={reconfigSelectedSsid}
                          onChangeText={setReconfigSelectedSsid}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        {reconfigSelectedSsid ? (
                          <Pressable onPress={() => setReconfigSelectedSsid('')} hitSlop={8} style={{ padding: 4 }}>
                            <ThemedText style={{ color: '#94a3b8', fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                          </Pressable>
                        ) : null}
                      </View>

                      {/* Quick Presets Row below Input */}
                      {reconfigWifiNetworks.some(net => net.isConnectedPhone || net.isSaved) && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <ThemedText style={[styles.quickPresetLabel, isDark && styles.textSlateLight]}>Quick Presets:</ThemedText>
                        {Array.from(new Set(reconfigWifiNetworks.filter(net => net.isConnectedPhone || net.isSaved).map(s => s.ssid))).map((preset) => {
                          const isSelected = reconfigSelectedSsid === preset;
                          return (
                            <Pressable
                              key={preset}
                              onPress={() => {
                                triggerHaptic();
                                setReconfigSelectedSsid(preset);
                              }}
                              style={[
                                styles.presetChip,
                                isDark ? styles.presetChipDark : styles.presetChipLight,
                                isSelected && styles.presetChipActive,
                              ]}
                            >
                              <ThemedText style={[styles.presetChipText, isSelected && styles.presetChipTextActive]}>
                                {isSelected ? '✓ ' : ''}{preset}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                      )}
                    </View>

                    {/* Saved Facility Networks (if any) */}
                    {reconfigWifiNetworks.some(net => net.isSaved) && (
                      <View style={[styles.inputGroup, { marginTop: 12 }]}>
                        <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                          Saved Facility Networks
                        </ThemedText>
                        <View style={styles.savedNetworksRow}>
                          {reconfigWifiNetworks.filter(net => net.isSaved).map((net) => {
                            const isSelected = reconfigSelectedSsid === net.ssid;
                            return (
                              <Pressable
                                key={net.ssid}
                                onPress={() => setReconfigSelectedSsid(net.ssid)}
                                style={[
                                  styles.savedNetworkChip,
                                  isDark ? styles.savedNetworkChipDark : styles.savedNetworkChipLight,
                                  isSelected && styles.savedNetworkChipActive,
                                ]}
                              >
                                <AppIcon
                                  name="wifi"
                                  size={13}
                                  color={isSelected ? '#10b981' : isDark ? '#94a3b8' : '#64748b'}
                                />
                                <ThemedText
                                  style={[
                                    styles.savedNetworkChipText,
                                    isSelected && { color: '#10b981', fontWeight: '800' },
                                    isDark && !isSelected && styles.textWhite,
                                  ]}
                                >
                                  {net.ssid}
                                </ThemedText>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}

                    {/* Password Input */}
                    <View style={[styles.inputGroup, { marginTop: 14 }]}>
                      <ThemedText style={[styles.inputLabel, isDark && styles.textSlateLight]}>
                        Wi-Fi Password
                      </ThemedText>
                      <View style={[styles.passwordRow, isDark ? styles.passwordRowDark : styles.passwordRowLight]}>
                        <TextInput
                          style={[styles.passwordInput, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
                          placeholder="Enter Wi-Fi Password"
                          placeholderTextColor="#94a3b8"
                          secureTextEntry={!reconfigShowPassword}
                          value={reconfigWifiPassword}
                          onChangeText={setReconfigWifiPassword}
                        />
                        <Pressable onPress={() => setReconfigShowPassword(!reconfigShowPassword)} hitSlop={10} style={{ padding: 4 }}>
                          <AppIcon
                            name={reconfigShowPassword ? 'eye-off' : 'eye'}
                            size={20}
                            color={isDark ? '#94a3b8' : '#64748b'}
                          />
                        </Pressable>
                      </View>
                    </View>

                    {reconfigError && (
                      <View style={[styles.errorBanner, { marginTop: 14 }]}>
                        <AppIcon
                          name="alert"
                          size={18}
                          color="#ef4444"
                        />
                        <ThemedText style={styles.errorText}>{reconfigError}</ThemedText>
                      </View>
                    )}

                    <Pressable
                      onPress={handleApplyReconfigureWifi}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.emerald, marginTop: 22 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.primaryButtonText}>Update Wi-Fi Settings</ThemedText>
                    </Pressable>

                    <Pressable
                      onPress={() => setReconfigStep('connect')}
                      style={[styles.textLinkBtn, { marginTop: 10 }]}
                    >
                      <ThemedText style={styles.textLinkBtnText}>← Back to Bluetooth Link</ThemedText>
                    </Pressable>
                  </View>
                )}

                {/* STEP 3: VERIFYING WI-FI CONFIGURATION */}
                {reconfigStep === 'verifying' && (
                  <View style={styles.wizardSection}>
                    <View style={styles.wizardHeaderCenter}>
                      <ActivityIndicator size="large" color="#10b981" />
                      <ThemedText style={[styles.wizardTitle, { marginTop: 14 }, isDark && styles.textWhite]}>
                        Reconfiguring Node Wi-Fi
                      </ThemedText>
                      <ThemedText style={styles.wizardSubtitle}>
                        {selectedDevice?.name} ({selectedDevice?.deviceId})
                      </ThemedText>
                    </View>

                    {/* Live Verification Checklist */}
                    <View style={[styles.checklistCard, isDark ? styles.checklistCardDark : styles.checklistCardLight]}>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: reconfigVerifyStep >= 1 ? '#10b981' : '#94a3b8', fontWeight: '800' }}>
                          {reconfigVerifyStep >= 1 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, reconfigVerifyStep >= 1 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Sending new credentials over BLE
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: reconfigVerifyStep >= 2 ? '#10b981' : '#94a3b8', fontWeight: '800' }}>
                          {reconfigVerifyStep >= 2 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, reconfigVerifyStep >= 2 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Connecting to {reconfigSelectedSsid}
                        </ThemedText>
                      </View>
                      <View style={styles.checklistItem}>
                        <ThemedText style={{ fontSize: 14, color: reconfigVerifyStep >= 3 ? '#10b981' : '#94a3b8', fontWeight: '800' }}>
                          {reconfigVerifyStep >= 3 ? '✓' : '○'}
                        </ThemedText>
                        <ThemedText style={[styles.checklistText, reconfigVerifyStep >= 3 && styles.checklistTextDone, isDark && styles.textWhite]}>
                          Confirming controller Wi-Fi connection
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                )}

                {/* STEP 4: SUCCESS */}
                {reconfigStep === 'success' && (
                  <View style={styles.wizardCenterBox}>
                    <View style={styles.successBadgeCircle}>
                      <ThemedText style={{ fontSize: 32, color: '#ffffff', fontWeight: '900' }}>✓</ThemedText>
                    </View>
                    <ThemedText style={[styles.wizardTitle, { marginTop: 16 }, isDark && styles.textWhite]}>
                      Wi-Fi Updated Successfully
                    </ThemedText>
                    <ThemedText style={styles.wizardSubtitle}>
                      {selectedDevice?.name} ({selectedDevice?.deviceId})
                    </ThemedText>

                    {/* Summary Card */}
                    <View style={[styles.successSummaryBox, isDark ? styles.successBoxDark : styles.successBoxLight]}>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Device</ThemedText>
                        <ThemedText style={{ color: '#10b981', fontWeight: '800' }}>{selectedDevice?.name}</ThemedText>
                      </View>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>New Network</ThemedText>
                        <ThemedText style={{ color: '#10b981', fontWeight: '800' }}>
                          ● {reconfigSelectedSsid}
                        </ThemedText>
                      </View>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Assigned IP</ThemedText>
                        <ThemedText style={{ color: '#10b981', fontWeight: '800' }}>{reconfigAssignedIp}</ThemedText>
                      </View>
                      <View style={styles.summaryRow}>
                        <ThemedText style={styles.summaryLabel}>Status</ThemedText>
                        <ThemedText style={{ color: '#10b981', fontWeight: '800' }}>● Wi-Fi connected; backend unverified</ThemedText>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => {
                        setReconfigModalVisible(false);
                        if (selectedDevice) {
                          handleOpenDetails(selectedDevice);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.emerald, width: '100%', marginTop: 20 },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText style={styles.primaryButtonText}>View Device Details</ThemedText>
                    </Pressable>

                    <Pressable
                      onPress={() => setReconfigModalVisible(false)}
                      style={styles.textLinkBtn}
                    >
                      <ThemedText style={styles.textLinkBtnText}>Done</ThemedText>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* 4. RENAME DEVICE MODAL                                                    */}
        {/* ========================================================================= */}
        <Modal
          visible={renameModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setRenameModalVisible(false)}
        >
          <View style={styles.confirmBackdrop}>
            <View style={[styles.confirmBox, isDark && styles.confirmBoxDark]}>
              <ThemedText style={[styles.confirmTitle, isDark && styles.textWhite]}>Rename Aircon Unit</ThemedText>
              <ThemedText style={styles.confirmDesc}>
                Enter a custom aircon name for {selectedDevice?.deviceId || 'this device'}.
              </ThemedText>

              <TextInput
                style={[
                  styles.inputField,
                  { width: '100%', marginBottom: 16 },
                  isDark ? styles.inputFieldDark : styles.inputFieldLight,
                ]}
                value={renameInput}
                onChangeText={setRenameInput}
                placeholder="Enter custom aircon name (e.g. Lab 204 Split AC)"
                placeholderTextColor="#94a3b8"
                autoFocus
              />

              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => setRenameModalVisible(false)}
                  style={[styles.confirmCancelBtn, isDark && styles.confirmCancelBtnDark]}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, isDark && styles.textWhite]}>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleSaveRename}
                  style={[styles.primaryButton, { flex: 1, backgroundColor: colors.emerald }]}
                >
                  <ThemedText style={styles.primaryButtonText}>Save</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* 4.5. REASSIGN ROOM MODAL                                                  */}
        {/* ========================================================================= */}
        <Modal
          visible={roomChangeModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => { if (!savingRoom) setRoomChangeModalVisible(false); }}
        >
          <View style={styles.confirmBackdrop}>
            <View style={[styles.confirmBox, { maxHeight: '80%' }, isDark && styles.confirmBoxDark]}>
              <ThemedText style={[styles.confirmTitle, isDark && styles.textWhite]}>Reassign Room</ThemedText>
              <ThemedText style={styles.confirmDesc}>
                Select or type the room location for {selectedDevice?.name}.
              </ThemedText>

              {/* Type / Search Room Input */}
              <View style={[styles.searchBox, isDark ? styles.searchBoxDark : styles.searchBoxLight, { paddingVertical: 8, marginBottom: 10, width: '100%' }]}>
                <AppIcon
                  name="search"
                  size={16}
                  color={isDark ? '#94a3b8' : '#64748b'}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={[styles.searchInput, { color: isDark ? '#f1f5f9' : '#1e293b' }]}
                  placeholder="Type or search room..."
                  placeholderTextColor={isDark ? '#64748b' : '#9ca3af'}
                  value={changeRoomSearchQuery}
                  onChangeText={setChangeRoomSearchQuery}
                  editable={!savingRoom}
                />
                {changeRoomSearchQuery.length > 0 && (
                  <Pressable disabled={savingRoom} onPress={() => setChangeRoomSearchQuery('')} hitSlop={8}>
                    <ThemedText style={{ color: '#94a3b8', fontSize: 13, fontWeight: '700' }}>✕</ThemedText>
                  </Pressable>
                )}
              </View>

              <ScrollView style={{ width: '100%', maxHeight: 260, marginBottom: 16 }} showsVerticalScrollIndicator={false}>
                {/* Custom Typed Room Option */}
                {isCustomChangeRoomQuery && (
                  <Pressable
                    disabled={savingRoom}
                    onPress={() => {
                      triggerHaptic();
                      setSelectedChangeRoomId(`custom:${changeRoomSearchQuery.trim()}`);
                    }}
                    style={[
                      styles.roomOptionItem,
                      isDark ? styles.roomOptionDark : styles.roomOptionLight,
                      selectedChangeRoomId === `custom:${changeRoomSearchQuery.trim()}` && styles.roomOptionActive,
                      { borderColor: '#10b981', borderStyle: 'dashed', borderWidth: 1.5 },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText style={[styles.roomOptionText, { color: '#10b981', fontWeight: '800' }]}>
                + Assign to &quot;{changeRoomSearchQuery.trim()}&quot;
                      </ThemedText>
                      <ThemedText style={styles.roomOptionSubText}>
                        Custom room location
                      </ThemedText>
                    </View>
                    {selectedChangeRoomId === `custom:${changeRoomSearchQuery.trim()}` && (
                      <ThemedText style={{ color: '#10b981', fontWeight: '800' }}>✓</ThemedText>
                    )}
                  </Pressable>
                )}

                {/* Unassigned Option */}
                {(!changeRoomSearchQuery || 'unassigned'.includes(changeRoomSearchQuery.toLowerCase())) && (
                  <Pressable
                    disabled={savingRoom}
                    onPress={() => {
                      triggerHaptic();
                      setSelectedChangeRoomId(null);
                      setChangeRoomSearchQuery('');
                    }}
                    style={[
                      styles.roomOptionItem,
                      isDark ? styles.roomOptionDark : styles.roomOptionLight,
                      selectedChangeRoomId === null && styles.roomOptionActive,
                    ]}
                  >
                    <ThemedText style={[styles.roomOptionText, selectedChangeRoomId === null && { color: '#10b981', fontWeight: '800' }, isDark && selectedChangeRoomId !== null && styles.textWhite]}>
                      — Unassigned —
                    </ThemedText>
                    {selectedChangeRoomId === null && (
                      <ThemedText style={{ color: '#10b981', fontWeight: '800' }}>✓</ThemedText>
                    )}
                  </Pressable>
                )}

                {filteredChangeRooms.map((room) => {
                  const isSel = selectedChangeRoomId === room.id;
                  return (
                    <Pressable
                      key={room.id}
                      disabled={savingRoom}
                      onPress={() => {
                        triggerHaptic();
                        setSelectedChangeRoomId(room.id);
                        setChangeRoomSearchQuery(room.name);
                        if (!changeRoomAirconName.trim()) {
                          setChangeRoomAirconName(room.airconName || `${room.name} Aircon`);
                        }
                      }}
                      style={[
                        styles.roomOptionItem,
                        isDark ? styles.roomOptionDark : styles.roomOptionLight,
                        isSel && styles.roomOptionActive,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.roomOptionText, isSel && { color: '#10b981', fontWeight: '800' }, isDark && !isSel && styles.textWhite]}>
                          {room.name}
                        </ThemedText>
                        <ThemedText style={styles.roomOptionSubText}>
                          {room.buildingName} • {room.floorName}
                          {room.airconBrand ? ` • ${room.airconBrand}` : ''}
                          {room.nodeName ? ` • Node: ${room.nodeName}` : ''}
                        </ThemedText>
                      </View>
                      {isSel && (
                        <ThemedText style={{ color: '#10b981', fontWeight: '800' }}>✓</ThemedText>
                      )}
                    </Pressable>
                  );
                })}

                {filteredChangeRooms.length === 0 && !isCustomChangeRoomQuery && (
                  <ThemedText style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, paddingVertical: 12 }}>
                    No matching rooms found.
                  </ThemedText>
                )}
              </ScrollView>

              {/* Edit Custom Aircon Name */}
              <View style={{ width: '100%', marginBottom: 10 }}>
                <ThemedText style={[styles.inputLabel, { fontSize: 11, marginBottom: 4 }, isDark && styles.textSlateLight]}>
                  Custom Aircon Name for this Room
                </ThemedText>
                <TextInput
                  style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight, { paddingVertical: 8, fontSize: 13 }]}
                  value={changeRoomAirconName}
                  onChangeText={setChangeRoomAirconName}
                  editable={!savingRoom}
                  placeholder="e.g. Lab 4 Daikin AC"
                  placeholderTextColor="#94a3b8"
                />
              </View>

              {/* Edit Custom Aircon Brand */}
              <View style={{ width: '100%', marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <ThemedText style={[styles.inputLabel, { fontSize: 11 }, isDark && styles.textSlateLight]}>
                    Custom Aircon Brand
                  </ThemedText>
                  <ThemedText style={{ fontSize: 10.5, color: '#10b981', fontWeight: '700' }}>
                    {changeRoomAirconBrand ? `Custom: ${changeRoomAirconBrand}` : 'Type / Select Brand'}
                  </ThemedText>
                </View>
                <TextInput
                  style={[styles.inputField, isDark ? styles.inputFieldDark : styles.inputFieldLight, { paddingVertical: 8, fontSize: 13, marginBottom: 8 }]}
                  value={changeRoomAirconBrand}
                  onChangeText={setChangeRoomAirconBrand}
                  editable={!savingRoom}
                  placeholder="Custom assign brand (e.g. Daikin, Carrier, Koppel)..."
                  placeholderTextColor="#94a3b8"
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                  {['Daikin', 'Carrier', 'Koppel', 'Panasonic', 'LG', 'Mitsubishi', 'Samsung', 'Midea', 'Gree', 'Condura', 'TCL', 'York'].map((b) => {
                    const isSel = (changeRoomAirconBrand || '').toLowerCase() === b.toLowerCase();
                    return (
                      <Pressable
                        key={b}
                        disabled={savingRoom}
                        onPress={() => {
                          triggerHaptic();
                          setChangeRoomAirconBrand(b);
                        }}
                        style={[
                          styles.airconPill,
                          isDark ? styles.airconPillDark : styles.airconPillLight,
                          isSel && styles.airconPillActive,
                          { paddingVertical: 4, paddingHorizontal: 10 },
                        ]}
                      >
                        <ThemedText style={[styles.airconPillText, { fontSize: 11 }, isSel && { color: '#ffffff', fontWeight: '700' }, isDark && !isSel && styles.textWhite]}>
                          {b}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => setRoomChangeModalVisible(false)}
                  disabled={savingRoom}
                  style={[styles.confirmCancelBtn, isDark && styles.confirmCancelBtnDark]}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, isDark && styles.textWhite]}>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleSaveChangeRoom}
                  disabled={savingRoom}
                  style={[styles.primaryButton, { flex: 1, backgroundColor: colors.emerald }]}
                >
                  <ThemedText style={styles.primaryButtonText}>{savingRoom ? 'Saving…' : 'Update'}</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* 5. REMOVE DEVICE CONFIRMATION MODAL                                       */}
        {/* ========================================================================= */}
        <Modal
          visible={removeConfirmVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setRemoveConfirmVisible(false)}
        >
          <View style={styles.confirmBackdrop}>
            <View style={[styles.confirmBox, isDark && styles.confirmBoxDark]}>
              <ThemedText style={[styles.confirmTitle, isDark && styles.textWhite]}>
                Remove Node?
              </ThemedText>
              <ThemedText style={styles.confirmDesc}>
                Are you sure you want to remove &quot;{selectedDevice?.name}&quot;?{'\n\n'}
                This will delete the node record from the system.
              </ThemedText>

              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => setRemoveConfirmVisible(false)}
                  style={[styles.confirmCancelBtn, isDark && styles.confirmCancelBtnDark]}
                >
                  <ThemedText style={[styles.confirmCancelBtnText, isDark && styles.textWhite]}>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleConfirmRemove}
                  style={styles.confirmDeleteBtn}
                >
                  <ThemedText style={styles.confirmDeleteBtnText}>Delete Node</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
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

  // Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: 'transparent',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 11.5,
    color: '#10b981',
    fontWeight: '700',
  },

  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },

  // Metrics Row
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: Spacing.two,
  },
  metricCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 74,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  metricCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  metricCardDark: {
    backgroundColor: '#151e32',
    borderColor: '#334155',
  },
  metricNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  metricNumber: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  metricLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 13,
  },

  // Inline Add Device Button
  inlineAddBtn: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 16,
    marginBottom: Spacing.three,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  inlineAddBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  // Search & Filter
  searchFilterContainer: {
    gap: 10,
    marginBottom: Spacing.three,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1.2,
    gap: 8,
  },
  searchBoxLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  searchBoxDark: {
    backgroundColor: '#151e32',
    borderColor: '#334155',
  },
  searchIcon: {
    width: 16,
    height: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    padding: 0,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.2,
  },
  filterPillLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  filterPillDark: {
    backgroundColor: '#151e32',
    borderColor: '#334155',
  },
  filterPillActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  filterPillTextActive: {
    color: '#ffffff',
  },
  filterPillTextLight: {
    color: '#64748b',
  },
  filterPillTextDark: {
    color: '#94a3b8',
  },

  sectionHeader: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adminToggleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  adminToggleBadgeLight: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  adminToggleBadgeDark: {
    backgroundColor: '#064e3b',
    borderColor: '#059669',
  },
  adminToggleBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#10b981',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  textEmeraldLight: {
    color: '#34d399',
  },
  textEmeraldDark: {
    color: '#059669',
  },
  textWhite: {
    color: '#ffffff',
  },
  textSlateLight: {
    color: '#cbd5e1',
  },

  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },

  // Device Cards
  deviceCard: {
    borderRadius: 20,
    borderWidth: 1.2,
    padding: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  deviceCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  deviceCardDark: {
    backgroundColor: '#151e32',
    borderColor: '#334155',
  },
  deviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  deviceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  deviceIdChip: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  deviceIdChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#10b981',
  },
  moreOptionsBtn: {
    padding: 6,
  },
  deviceLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  locationPinIcon: {
    width: 13,
    height: 13,
    tintColor: '#10b981',
  },
  deviceLocationText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  textSlateDark: {
    color: '#475569',
  },

  deviceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusPillOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  statusPillOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  telemetryBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  telemetryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  wifiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  wifiBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  lastSeenText: {
    fontSize: 11,
    color: '#94a3b8',
    marginLeft: 'auto',
    fontWeight: '600',
  },

  deviceCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148, 163, 184, 0.2)',
  },
  addedDateText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  viewDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  viewDetailsBtnLight: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  viewDetailsBtnDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  viewDetailsBtnText: {
    color: '#10b981',
    fontWeight: '800',
    fontSize: 12,
  },

  // Empty State
  emptyStateCard: {
    padding: 28,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    marginTop: 10,
  },
  emptyCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  emptyCardDark: {
    backgroundColor: '#151e32',
    borderColor: '#334155',
  },
  emptyIconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
  },
  emptyDesc: {
    fontSize: 12.5,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
    paddingHorizontal: 10,
  },

  // Modal Common Styles
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  modalContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    height: '86%',
    padding: Spacing.four,
  },
  modalContentLight: {
    backgroundColor: '#ffffff',
  },
  modalContentDark: {
    backgroundColor: '#151e32',
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(16, 185, 129, 0.45)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 14,
    marginBottom: 10,
  },
  modalHeaderDark: {
    borderBottomColor: '#1e293b',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    flex: 1,
    marginRight: 12,
  },
  closeModalText: {
    fontSize: 14,
    color: '#ef4444',
    fontWeight: '800',
  },
  modalScrollBody: {
    paddingBottom: 36,
  },

  // Step Progress Bar
  stepProgressBar: {
    paddingVertical: 10,
    marginBottom: 10,
  },
  stepNodesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepNodeContainer: {
    alignItems: 'center',
  },
  stepNodeCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNodeCircleCurrent: {
    backgroundColor: '#10b981',
  },
  stepNodeCirclePassed: {
    backgroundColor: '#059669',
  },
  stepNodeCircleFutureLight: {
    backgroundColor: '#e2e8f0',
  },
  stepNodeCircleFutureDark: {
    backgroundColor: '#1e293b',
  },
  stepNodeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  stepNodeLabel: {
    fontSize: 9.5,
    color: '#94a3b8',
    fontWeight: '700',
    marginTop: 2,
  },
  stepConnectorLine: {
    flex: 1,
    height: 2,
    marginHorizontal: 4,
    marginBottom: 12,
  },
  stepLineActive: {
    backgroundColor: '#10b981',
  },
  stepLineLight: {
    backgroundColor: '#e2e8f0',
  },
  stepLineDark: {
    backgroundColor: '#1e293b',
  },

  // Wizard Content
  wizardSection: {
    paddingTop: 8,
  },
  wizardHeaderCenter: {
    alignItems: 'center',
    marginBottom: 16,
  },
  radarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#10b981',
  },
  iconCircleEmerald: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  wizardTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
  },
  wizardSubtitle: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  wizardCenterBox: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },

  bleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.2,
    marginTop: 8,
  },
  bleCardLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  bleCardDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  bleName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0f172a',
  },
  bleChip: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  bleChipText: {
    fontSize: 10.5,
    color: '#10b981',
    fontWeight: '800',
  },
  bleMacText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
    fontWeight: '600',
  },
  bleAddBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 10,
  },
  bleAddBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },

  // Wi-Fi Selection & Configuration
  wifiInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flexInput: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    padding: 0,
  },
  wifiFreqBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  wifiFreqBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10b981',
    letterSpacing: 0.3,
  },
  savedNetworksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  savedNetworkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  savedNetworkChipLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  savedNetworkChipDark: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
  },
  savedNetworkChipActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  savedNetworkChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  removeSavedNetBtn: {
    padding: 2,
    marginLeft: 2,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  rememberCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rememberText: {
    fontSize: 12,
    fontWeight: '600',
  },
  wifiNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  wifiNoticeBoxLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  wifiNoticeBoxDark: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
  },
  wifiNoticeText: {
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  wifiItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.2,
    marginTop: 6,
  },
  wifiItemLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  wifiItemDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  wifiItemActive: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  wifiItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },

  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  passwordRowLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  passwordRowDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  passwordInput: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    padding: 0,
  },

  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  inputField: {
    borderRadius: 14,
    borderWidth: 1.2,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13.5,
    fontWeight: '600',
  },
  inputFieldLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    color: '#0f172a',
  },
  inputFieldDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
    color: '#f1f5f9',
  },
  readOnlyInput: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  readOnlyInputLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  readOnlyInputDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },

  airconPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 8,
  },
  airconPillLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  airconPillDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  airconPillActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  airconPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },

  roomOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
  },
  roomOptionLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  roomOptionDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  roomOptionActive: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  roomOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  roomOptionSubText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
    fontWeight: '600',
  },

  // Verification Checklist
  checklistCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    marginTop: 8,
  },
  checklistCardLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  checklistCardDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checklistText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  checklistTextDone: {
    color: '#10b981',
    fontWeight: '700',
  },

  // Success Wizard
  successBadgeCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successSummaryBox: {
    width: '100%',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 18,
    gap: 8,
  },
  successBoxLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  successBoxDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 12,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  idBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    maxWidth: '65%',
  },
  idBadgeLight: {
    backgroundColor: '#ecfdf5',
  },
  idBadgeDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  idBadgeText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    color: '#10b981',
    fontWeight: '800',
  },
  statusSuccessPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  statusSuccessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  statusSuccessText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#10b981',
  },
  summaryDivider: {
    height: 1,
    marginVertical: 4,
  },
  summaryDividerLight: {
    backgroundColor: '#e2e8f0',
  },
  summaryDividerDark: {
    backgroundColor: '#1e293b',
  },
  summaryLocationSection: {
    marginTop: 4,
    gap: 6,
  },
  summaryLocationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  summaryLocationCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  summaryLocationCardDark: {
    backgroundColor: '#151e32',
    borderColor: '#1e293b',
  },
  summaryLocationIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRoomTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#10b981',
  },
  summaryLocationSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 1,
    fontWeight: '500',
  },

  // Device Details Modal Styles
  infoList: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginTop: 6,
  },
  infoListLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  infoListDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoKey: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
    flexShrink: 0,
    lineHeight: 18,
  },
  infoVal: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
    textAlign: 'right',
    lineHeight: 18,
  },
  testResultBox: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  testBoxLight: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  testBoxDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  actionsColumn: {
    gap: 10,
    marginTop: 10,
  },
  actionBtn: {
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  actionBtnDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  actionBtnDestructive: {
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Options Popup
  optionsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  optionsPopup: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1.2,
  },
  optionsPopupLight: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  optionsPopupDark: {
    backgroundColor: '#151e32',
    borderColor: '#334155',
  },
  optionsPopupTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 12,
    textAlign: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148, 163, 184, 0.2)',
  },
  optionRowText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0f172a',
  },

  // Confirmation Modals
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmBox: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#10b981',
    backgroundColor: '#ffffff',
  },
  confirmBoxDark: {
    backgroundColor: '#151e32',
    borderColor: '#334155',
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 6,
    textAlign: 'center',
  },
  confirmDesc: {
    fontSize: 12.5,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 18,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  confirmCancelBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  confirmCancelBtnDark: {
    backgroundColor: '#0a0f1d',
    borderColor: '#334155',
  },
  confirmCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },

  // Buttons Common
  primaryButton: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnLight: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  secondaryBtnDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  textLinkBtn: {
    paddingVertical: 10,
    marginTop: 6,
  },
  textLinkBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    textDecorationLine: 'underline',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fee2e2',
    padding: 10,
    borderRadius: 12,
    marginTop: 14,
    width: '100%',
  },
  errorText: {
    fontSize: 12,
    color: '#991b1b',
    fontWeight: '600',
    flex: 1,
  },
  // Wi-Fi Auto-Search & Discovered Networks Styles
  rescanWifiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.2,
    flexShrink: 0,
  },
  rescanWifiBtnLight: {
    backgroundColor: '#ffffff',
    borderColor: '#a7f3d0',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  rescanWifiBtnDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: '#047857',
  },
  rescanWifiBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#10b981',
  },
  wifiEmptyCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  wifiEmptyCardLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  wifiEmptyCardDark: {
    backgroundColor: '#0d1829',
    borderColor: '#1e293b',
  },
  wifiEmptyIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  wifiEmptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  wifiEmptySubtitle: {
    fontSize: 11.5,
    color: '#64748b',
    lineHeight: 16,
    marginTop: 2,
  },
  presetChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  presetChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  presetChipLight: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
  },
  presetChipDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  presetChipActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  presetChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748b',
  },
  presetChipTextActive: {
    color: '#10b981',
    fontWeight: '800',
  },
  quickPresetLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748b',
  },
  wifiScanningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  wifiScanningBannerLight: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  wifiScanningBannerDark: {
    backgroundColor: '#062015',
    borderColor: '#064e3b',
  },
  wifiScanningTitle: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  wifiScanningSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
  },
  discoveredWifiList: {
    gap: 8,
    marginBottom: 14,
  },
  wifiItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.2,
  },
  wifiItemCardLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  wifiItemCardDark: {
    backgroundColor: '#0d1829',
    borderColor: '#1e293b',
  },
  wifiItemCardActiveLight: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
  },
  wifiItemCardActiveDark: {
    backgroundColor: '#062015',
    borderColor: '#10b981',
  },
  wifiSignalIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wifiItemSsid: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0f172a',
  },
  wifiItemMeta: {
    fontSize: 11,
    color: '#64748b',
  },
  savedNetMiniBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  savedNetMiniBadgeText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '800',
  },
  wifiRadioBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#94a3b8',
  },
  // Custom Aircon Name & Suggestion Pill Styles
  customBadgePill: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  customBadgeText: {
    color: '#10b981',
    fontSize: 10.5,
    fontWeight: '800',
  },
  customNameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  nameSugPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 6,
  },
  nameSugPillLight: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  nameSugPillDark: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
  },
  nameSugPillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  nameSugPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
  },
});
