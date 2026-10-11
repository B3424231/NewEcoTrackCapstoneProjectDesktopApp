import { useState, useRef, useEffect, useCallback } from 'react';
import { createReadScope } from '@/services/query-utils';
import { createRefreshCoordinator, type RefreshCoordinator } from '@/services/refresh-coordinator';

import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Platform,
  useColorScheme,
  Animated,
  Dimensions,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { router } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, GlassStyles, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useSettings } from '@/context/settings-context';
import {
  fetchLiveAcControllers,
  subscribeToNodes,
  fetchActiveRoom,
  ActiveRoomData,
  resolveWorkerAssignment,
  WorkerAssignmentResult,
} from '@/services/supabase';

// Import newly organized dashboard subcomponents
import { AcControllerCard, AcControllerData } from '@/components/sensor-card';
import { AcControllerDetailSheet } from '@/components/sensor-detail-sheet';
import { FloatingBottomNavbar } from '@/components/floating-navbar';
import { LocationIcon } from '@/components/location-icon';
import { AppIcon } from '@/components/app-icon';


const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SIDEBAR_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 340);

const AVATAR_DEFAULT = require('@/assets/images/avatar_default.png');
const AVATAR_MALE = require('@/assets/images/avatar_male.png');
const AVATAR_FEMALE = require('@/assets/images/avatar_female.png');

export default function HomeScreen() {
  const { logout, userId, userName, userRole, userPhone, userEmail, userAssignment, setUserAssignment, userAvatar, userCustomPhotoUri } = useAuth();
  const { effectiveTheme, colors, settings, triggerHaptic } = useSettings();
  const theme = effectiveTheme;

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Supabase live AC controllers and room assignment state
  const [controllers, setControllers] = useState<AcControllerData[]>([]);
  const [activeRoom, setActiveRoom] = useState<ActiveRoomData | null>(null);
  const [assignmentInfo, setAssignmentInfo] = useState<WorkerAssignmentResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const refreshRef = useRef<RefreshCoordinator | null>(null);
  const snapshotUser = useRef<string | null>(null);
  const fetchUser = userId || userEmail || userPhone || userName;

  const fetchControllers = useCallback(async (isCurrent: () => boolean) => {
    if (snapshotUser.current !== fetchUser) {
      setLoading(true);
      setControllers([]);
      setActiveRoom(null);
      setAssignmentInfo(null);
    }
    const scope = createReadScope();
    try {
      const resolved = await resolveWorkerAssignment(userEmail || userPhone || userName, scope);
      scope.assertSuccessful();
      const [controllerData, roomData] = resolved.isAssigned && resolved.roomId
        ? await Promise.all([fetchLiveAcControllers(resolved.roomId, scope), fetchActiveRoom(resolved.roomId, scope)])
        : [[], null];
      scope.assertSuccessful();
      if (!isCurrent()) return;
      snapshotUser.current = fetchUser;
      setAssignmentInfo(resolved);
      setUserAssignment(resolved.assignmentText);
      setControllers(controllerData || []);
      setActiveRoom(roomData);
      setFetchError(null);
    } catch (err) {
      console.error('Error fetching AC controllers:', err);
      if (isCurrent()) setFetchError('Unable to refresh controllers. Pull down to try again.');
    } finally {
      if (isCurrent()) { setLoading(false); setRefreshing(false); }
    }
  }, [fetchUser, userEmail, userPhone, userName, setUserAssignment]);

  useEffect(() => {
    const refresh = createRefreshCoordinator(fetchControllers);
    refreshRef.current = refresh;
    void refresh.refresh();
    const unsubscribe = settings.autoSyncEnabled ? subscribeToNodes(() => refresh.schedule()) : () => {};
    const intervalId = settings.autoSyncEnabled ? setInterval(() => { void refresh.refresh(); }, settings.syncFrequency * 1000) : null;
    return () => {
      refresh.dispose();
      if (refreshRef.current === refresh) refreshRef.current = null;
      unsubscribe();
      if (intervalId) clearInterval(intervalId);
    };
  }, [fetchControllers, settings.autoSyncEnabled, settings.syncFrequency]);

  const onRefresh = () => {
    setRefreshing(true);
    void refreshRef.current?.refresh();
  };

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.4,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const getAvatarSource = (avatar: string, uri: string | null) => {
    if (avatar === 'custom' && uri) {
      return { uri };
    }
    if (avatar === 'male') return AVATAR_MALE;
    if (avatar === 'female') return AVATAR_FEMALE;
    return AVATAR_DEFAULT;
  };

  // States
  const [selectedController, setSelectedController] = useState<AcControllerData | null>(null);
  const [bottomSheetVisible, setBottomSheetVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const openDetails = (item: AcControllerData) => {
    setSelectedController(item);
    setBottomSheetVisible(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  };

  // Close details bottom sheet
  const closeDetails = () => {
    Animated.timing(slideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setBottomSheetVisible(false);
      setSelectedController(null);
    });
  };

  return (
    <LinearGradient 
      colors={effectiveTheme === 'dark' ? ['#0b0f19', '#06080e'] : ['#eefbf4', '#f8fafc']} 
      style={[styles.container, { backgroundColor: colors.background }]} 
      start={{ x: 0, y: 0 }} 
      end={{ x: 0, y: 0.35 }}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        
        {/* Telemetry Page content wrap */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.emerald}
              colors={[colors.emerald]}
            />
          }
        >
          {/* Main Dashboard Screen Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Image
                source={require('@/assets/images/ecoTrack.png')}
                style={styles.headerLogo}
                contentFit="contain"
              />
              <View>
                <ThemedText type="smallBold" style={[styles.headerTitle, { color: colors.text }]}>
                  EcoTrack
                </ThemedText>
                <ThemedText style={{ fontSize: 12, color: colors.emerald, fontWeight: '700' }}>
                  Dashboard
                </ThemedText>
              </View>
            </View>
            

          </View>

          <View style={styles.contentBody}>
            {/* User Profile Info Card */}
            <View style={[
              styles.userProfileCard, 
              { 
                backgroundColor: effectiveTheme === 'dark' ? '#121826' : '#ffffff',
                borderColor: effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : '#d1fae5',
              }
            ]}>
              {/* Card Top Section: Avatar & Main Details */}
              <View style={styles.cardTopSection}>
                <View style={styles.avatarContainer}>
                  <Image
                    source={getAvatarSource(userAvatar, userCustomPhotoUri)}
                    style={styles.userProfileCardAvatar}
                    contentFit="cover"
                  />
                  <View style={styles.statusDotWrapper}>
                    <Animated.View style={[styles.statusDotPulse, { transform: [{ scale: pulseAnim }] }]} />
                    <View style={styles.statusDot} />
                  </View>
                </View>
                
                <View style={styles.userProfileCardDetails}>
                  <ThemedText style={[styles.userProfileCardName, { color: colors.text }]}>
                    {userName || 'Staff Member'}
                  </ThemedText>
                  
                  {/* Role Badge Container */}
                  <View style={[
                    styles.roleBadge,
                    {
                      backgroundColor: effectiveTheme === 'dark' ? '#064e3b' : '#ecfdf5',
                      borderColor: effectiveTheme === 'dark' ? '#059669' : '#a7f3d0',
                    }
                  ]}>
                    <ThemedText style={[styles.roleBadgeText, { color: effectiveTheme === 'dark' ? '#34d399' : '#047857' }]}>
                      {userRole || 'Staff'}
                    </ThemedText>
                  </View>
                  
                  {/* Phone Row */}
                  <View style={styles.phoneRow}>
                    <ThemedText style={[styles.phoneLabel, { color: colors.textSecondary }]}>Phone:</ThemedText>
                    <ThemedText style={[styles.userProfileCardPhone, { color: colors.text }]}>
                      {userPhone || '—'}
                    </ThemedText>
                  </View>
                </View>
              </View>

              {/* Card Bottom Section: Verified badge row */}
              <View style={[styles.cardBottomRow, { borderTopColor: effectiveTheme === 'dark' ? '#1e293b' : '#f1f5f9' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, flex: 1 }}>
                  <LocationIcon size={14} color="#10b981" style={{ marginTop: 2, flexShrink: 0 }} />
                  <ThemedText
                    style={[styles.cardBottomText, { color: effectiveTheme === 'dark' ? '#34d399' : '#059669', flex: 1 }]}
                    numberOfLines={2}
                  >
                    Active Duty • {userAssignment || 'Unassigned'}
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Room Location Context Bar */}
            {activeRoom ? (
              <View style={[
                styles.roomContextCard,
                {
                  backgroundColor: effectiveTheme === 'dark' ? '#121826' : '#ffffff',
                  borderColor: effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : '#a7f3d0',
                }
              ]}>
                <View style={styles.roomContextTop}>
                  <View style={styles.roomIconTitleGroup}>
                    <View style={[styles.roomIconCircle, { backgroundColor: effectiveTheme === 'dark' ? '#1e293b' : 'rgba(5, 150, 105, 0.12)' }]}>
                      <LocationIcon size={16} color="#10b981" />
                    </View>
                    <View style={styles.roomTextContainer}>
                      <ThemedText style={[styles.roomTitleText, { color: colors.text }]} numberOfLines={1}>
                        {activeRoom.name}
                      </ThemedText>
                      <ThemedText style={[styles.roomSubtitleText, { color: colors.emerald }]} numberOfLines={2}>
                        {activeRoom.buildingName} • {activeRoom.floorName}
                      </ThemedText>
                    </View>
                  </View>

                  {/* Device Count Badge */}
                  <View style={[styles.roomCapacityBadge, { backgroundColor: effectiveTheme === 'dark' ? '#1e293b' : '#f0fdf4', borderColor: effectiveTheme === 'dark' ? '#334155' : '#bbf7d0' }]}>
                    <ThemedText style={[styles.roomCapacityText, { color: effectiveTheme === 'dark' ? '#34d399' : '#065f46' }]}>
                      {controllers.length} {controllers.length === 1 ? 'device' : 'devices'}
                    </ThemedText>
                  </View>
                </View>
              </View>
            ) : (
              <View style={[
                styles.unassignedCard,
                {
                  backgroundColor: effectiveTheme === 'dark' ? '#1c1917' : '#fffbeb',
                  borderColor: effectiveTheme === 'dark' ? '#78350f' : '#fde68a',
                }
              ]}>
                <View style={styles.unassignedCardTop}>
                  <View style={styles.unassignedIconCircle}>
                    <LocationIcon size={16} color="#9ca3af" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.unassignedTitleText, { color: effectiveTheme === 'dark' ? '#fde68a' : '#92400e' }]}>
                      Unassigned
                    </ThemedText>
                    <ThemedText style={[styles.unassignedSubtitleText, { color: effectiveTheme === 'dark' ? '#d97706' : '#b45309' }]}>
                      No active room assignment
                    </ThemedText>
                  </View>
                  <View style={styles.unassignedPill}>
                    <ThemedText style={styles.unassignedPillText}>STANDBY</ThemedText>
                  </View>
                </View>
                <ThemedText style={[styles.unassignedDescText, { color: effectiveTheme === 'dark' ? '#fcd34d' : '#92400e' }]}>
                  If your assigned room or building floor was erased on the desktop dashboard, you are assigned as Unassigned. Please contact your administrator.
                </ThemedText>
              </View>
            )}

            {/* Assigned Room AC Controller Devices Section Header */}
            <View style={styles.sectionHeaderContainer}>
              <View style={styles.sectionTitleRow}>
                <ThemedText type="smallBold" style={[styles.sectionTitle, { color: colors.text }]}>
                  {activeRoom ? `ASSIGNED AC CONTROLLER DEVICES (${controllers.length})` : 'ASSIGNED AC CONTROLLER DEVICES (0)'}
                </ThemedText>
                <View style={[
                  styles.liveSyncPill,
                  {
                    backgroundColor: effectiveTheme === 'dark' ? '#121826' : '#ffffff',
                    borderColor: effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0',
                  },
                  !settings.autoSyncEnabled && { backgroundColor: '#f1f5f9', borderColor: '#cbd5e1' },
                ]}>
                  <View style={[
                    styles.livePulseDot,
                    !settings.autoSyncEnabled && { backgroundColor: '#94a3b8' },
                  ]} />
                </View>
              </View>
              <View style={[styles.thinDivider, { backgroundColor: effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : '#a7f3d0' }]} />
            </View>
            
            {fetchError && <ThemedText style={{ color: colors.textSecondary, marginBottom: 12 }}>{fetchError}</ThemedText>}
            <View style={styles.deviceGrid}>
              {loading && controllers.length === 0 ? (
                <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="large" color="#059669" />
                  <ThemedText style={{ marginTop: 12, fontSize: 13, color: '#6b7280', fontWeight: '600' }}>
                    Syncing AC controller devices...
                  </ThemedText>
                </View>
              ) : fetchError && !activeRoom ? null : !activeRoom ? (
                <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <LocationIcon size={36} color={colors.textSecondary} />
                  <ThemedText style={{ marginTop: 12, fontSize: 15, color: colors.text, fontWeight: '800' }}>
                    No Assigned AC Controller Devices
                  </ThemedText>
                  <ThemedText style={{ marginTop: 6, fontSize: 12.5, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 30, lineHeight: 18 }}>
                      You are currently unassigned. Once assigned to an active room by an administrator, your room&apos;s AC controller devices will appear here automatically.
                  </ThemedText>
                </View>
              ) : controllers.length === 0 ? (
                <View style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name="bolt" size={36} color={colors.emerald} />
                  <ThemedText style={{ marginTop: 12, fontSize: 14, color: colors.text, fontWeight: '800' }}>
                    No AC controller devices assigned to {activeRoom.name}.
                  </ThemedText>
                  <ThemedText style={{ marginTop: 6, fontSize: 12, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 30, lineHeight: 18 }}>
                    AC controller devices placed into this room will appear here live.
                  </ThemedText>
                </View>
              ) : (
                controllers.map((controller) => (
                  <AcControllerCard
                    key={controller.id}
                    controller={controller}
                    onPress={() => openDetails(controller)}
                  />
                ))
              )}
            </View>

          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Slide-up Bottom Sheet Modal */}
      <AcControllerDetailSheet
        visible={bottomSheetVisible}
        controller={selectedController}
        onClose={closeDetails}
        slideAnim={slideAnim}
      />

      {!bottomSheetVisible && <FloatingBottomNavbar currentPage="home" />}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    backgroundColor: 'transparent',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
    color: '#064e3b',
  },
  hamburgerTriggerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    position: 'relative',
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
  hamburgerBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#ef4444',
    width: 15,
    height: 15,
    borderRadius: 7.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ffffff',
    zIndex: 10,
  },
  hamburgerBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 11,
  },
  lightTriggerButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  headerHamburgerLine: {
    width: 18,
    height: 2,
    backgroundColor: '#10b981',
    borderRadius: 1,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  contentBody: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    marginTop: Spacing.four,
  },
  welcomeBanner: {
    borderRadius: 24,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  welcomeText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  welcomeSub: {
    color: '#a7f3d0',
    fontSize: 13,
    lineHeight: 18,
  },
  // Room Location Context Card (Mirroring Desktop Middle Panel)
  roomContextCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#a7f3d0',
    borderRadius: 18,
    padding: 14,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
    ...Platform.select({
      ios: {
        shadowColor: '#059669',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  roomContextTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  roomIconTitleGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    marginRight: 6,
  },
  roomTextContainer: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  roomIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(5, 150, 105, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  roomTitleText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#064e3b',
    letterSpacing: 0.2,
  },
  roomSubtitleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
    marginTop: 2,
    lineHeight: 15,
  },
  roomCapacityBadge: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  roomCapacityText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065f46',
  },
  unassignedCard: {
    backgroundColor: '#fffbeb',
    borderWidth: 1.5,
    borderColor: '#fde68a',
    borderRadius: 18,
    padding: 14,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  unassignedCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  unassignedIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(217, 119, 6, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unassignedTitleText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#92400e',
  },
  unassignedSubtitleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b45309',
    marginTop: 1,
  },
  unassignedPill: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  unassignedPillText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#d97706',
    letterSpacing: 0.5,
  },
  unassignedDescText: {
    fontSize: 11,
    color: '#92400e',
    lineHeight: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveSyncPill: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  liveSyncText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sectionHeaderContainer: {
    marginTop: Spacing.two,
    alignItems: 'stretch',
  },
  thinDivider: {
    height: 1,
    backgroundColor: '#a7f3d0', // thin white emerald green color highlight line
    marginTop: 6,
    width: '100%',
  },
  deviceGrid: {
    gap: Spacing.three,
  },
  infoSection: {
    borderRadius: 20,
    padding: Spacing.four,
  },
  lightInfoSection: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
  },
  userProfileCard: {
    flexDirection: 'column',
    alignItems: 'stretch',
    backgroundColor: '#f4fbf7', // Premium soft mint tint background
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  cardTopSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarContainer: {
    position: 'relative',
    width: 80,
    height: 80,
  },
  userProfileCardAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2.5,
    borderColor: '#d1d5db', // Changed border line color into gray
  },
  statusDotWrapper: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  statusDotPulse: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.45)',
  },
  userProfileCardDetails: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  userProfileCardName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0b291d',
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e6f7f0', // soft emerald background tint
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: '#a7f3d0',
    maxWidth: '100%',
  },
  roleBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    lineHeight: 13,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
    flexWrap: 'wrap',
  },
  phoneLabel: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '700',
  },
  userProfileCardPhone: {
    fontSize: 12,
    color: '#4b5563',
    fontWeight: '700',
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(16, 185, 129, 0.12)',
    paddingTop: 10,
    marginTop: 12,
  },
  cardBottomText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.3,
    lineHeight: 15,
  },
});
