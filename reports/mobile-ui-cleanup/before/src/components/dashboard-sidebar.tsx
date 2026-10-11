import { useState, useEffect } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Platform, Animated, Dimensions, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { router } from 'expo-router';
import { useAuth } from '@/context/auth-context';
import { useSettings } from '@/context/settings-context';

const AVATAR_DEFAULT = require('@/assets/images/avatar_default.png');
const AVATAR_MALE = require('@/assets/images/avatar_male.png');
const AVATAR_FEMALE = require('@/assets/images/avatar_female.png');

const SCREEN_WIDTH = Dimensions.get('window').width;
const SIDEBAR_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 340);

import { ICON_LOCATION, ICON_SETTINGS, getColoredSvgUri } from '@/constants/custom-icons';
import { LocationIcon } from './location-icon';

const ICON_NOTIFICATION = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNOTkgMjFINWEyIDIgMCAwIDEtMi0yVjVhMiAyIDAgMCAxIDItMmg0Ii8+PHBvbHlsaW5lIHBvaW50cz0iMTYgMTcgMjEgMTIgMTYgNyIvPjxsaW5lIHgxPSIyMSIgeTE9IjEyIiB4Mj0iOSIgeTI9IjEyIi8+PC9zdmc+';
const ICON_PROFILE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAgMjF2LTJhNCA0IDAgMCAwLTQtNEg4YTQgNCAwIDAgMC00IDR2MiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iNyIgcj0iNCIvPjwvc3ZnPg==';
const ICON_LOGOUT = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNOSAyMWgtMmEyIDIgMCAwIDEtMi0ydi0xNGEyIDIgMCAwIDEgMi0yaDJtMTQgN2wtNSA1bTUtNS01LTVtNSA1SDkiLz48L3N2Zz4=';

export type PageType = 'sensor-location' | 'ac-control' | 'notifications' | 'maintenance' | 'profile' | 'settings';

interface MenuItem {
  id: PageType;
  label: string;
  icon: string;
}

interface DashboardSidebarProps {
  visible: boolean;
  onClose: () => void;
  sidebarSlideAnim: Animated.Value;
  currentPage: PageType;
  onPageChange?: (page: PageType) => void;
  logout: () => void;
}

export function DashboardSidebar({
  visible,
  onClose,
  sidebarSlideAnim,
  currentPage,
  onPageChange,
  logout,
}: DashboardSidebarProps) {
  const { userAvatar, userCustomPhotoUri, userRole, userType } = useAuth();
  const { effectiveTheme } = useSettings();
  const isDark = effectiveTheme === 'dark';
  const isAdmin = userType === 'admin' || userRole?.toLowerCase().includes('admin');

  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [localActive, setLocalActive] = useState<PageType>(currentPage);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);

  const getSidebarAvatarSource = (avatar: string, uri: string | null) => {
    if (uri) {
      return { uri };
    }
    if (avatar === 'male') return AVATAR_MALE;
    if (avatar === 'female') return AVATAR_FEMALE;
    return AVATAR_DEFAULT;
  };

  useEffect(() => {
    if (visible) {
      setSidebarVisible(true);
      setLocalActive(currentPage);
    }
  }, [visible, currentPage]);

  if (!visible) return null;

  const sidebarBackdropOpacity = sidebarSlideAnim.interpolate({
    inputRange: [0, SIDEBAR_WIDTH],
    outputRange: [1, 0],
  });

  const mainMenuItems: MenuItem[] = [
    { id: 'sensor-location', label: 'AC Controller Devices', icon: ICON_LOCATION },
    ...(isAdmin ? [{ id: 'ac-control' as PageType, label: 'AC Remote Controls', icon: ICON_SETTINGS }] : []),
    { id: 'notifications', label: 'Notifications', icon: ICON_NOTIFICATION },
    { id: 'maintenance', label: 'Maintenance', icon: ICON_SETTINGS },
    { id: 'profile', label: isAdmin ? 'Admin Profile' : 'My Profile', icon: ICON_PROFILE },
    { id: 'settings', label: 'Settings', icon: ICON_SETTINGS },
  ];

  const handleNavigation = (page: PageType) => {
    setLocalActive(page);
    if (onPageChange) {
      onPageChange(page);
    }

    // Smoothly slide out sidebar before transitioning screens
    Animated.timing(sidebarSlideAnim, {
      toValue: SIDEBAR_WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      onClose(); // Set sidebar visibility to false
      if (page === 'sensor-location') {
        router.replace('/');
      } else if (page === 'ac-control') {
        router.replace('/explore' as any);
      } else if (page === 'maintenance') {
        router.replace('/Maintenance' as any);
      } else {
        router.replace(`/${page === 'profile' ? 'profile' : page === 'notifications' ? 'notification' : page}` as any);
      }
    });
  };

  return (
    <View style={styles.sidebarOverlayContainer}>
      {/* Backdrop */}
      <Animated.View style={[styles.sidebarBackdrop, { opacity: sidebarBackdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Drawer Panel */}
      <Animated.View
        style={[
          styles.sidebarContainer,
          { transform: [{ translateX: sidebarSlideAnim }] },
        ]}
      >
        <SafeAreaView style={styles.sidebarSafeArea} edges={['top', 'bottom']}>
          
          {/* Header (EcoTrack logo + Hamburger) */}
          <View style={styles.sidebarHeader}>
            <View style={styles.headerTitleRow}>
              <Image
                source={require('@/assets/images/ecoTrack.png')}
                style={styles.logoImage}
                contentFit="contain"
              />
              <ThemedText style={styles.logoTitle}>
                EcoTrack
              </ThemedText>
            </View>
            <Pressable onPress={onClose} style={styles.hamburgerButton}>
              {/* Custom 3-line hamburger matching reference image */}
              <View style={styles.hamburgerLine} />
              <View style={styles.hamburgerLine} />
              <View style={styles.hamburgerLine} />
            </Pressable>
          </View>

          {/* Scrollable Navigation List */}
          <ScrollView
            style={styles.menuScroll}
            contentContainerStyle={styles.menuScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.menuGroup}>
              {mainMenuItems.map((item) => {
                const isActive = localActive === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => handleNavigation(item.id)}
                    style={({ pressed }) => [
                      styles.menuItem,
                      isActive && styles.menuItemActive,
                      pressed && styles.menuItemPressed,
                    ]}
                  >
                    <View style={styles.iconContainer}>
                      {item.id === 'sensor-location' ? (
                        <LocationIcon size={20} color={isActive ? '#10b981' : '#6b7280'} />
                      ) : (
                        <Image
                          source={{ uri: getColoredSvgUri(item.icon, isActive ? '#10b981' : (isDark ? '#94a3b8' : '#6b7280')) }}
                          style={[
                            styles.menuIcon, 
                            isActive ? styles.menuIconActive : styles.menuIconInactive
                          ]}
                          tintColor={isActive ? '#10b981' : (isDark ? '#94a3b8' : '#6b7280')}
                          contentFit="contain"
                        />
                      )}
                      {item.id === 'notifications' && (
                        <View style={styles.sidebarBadge}>
                          <ThemedText style={styles.sidebarBadgeText}>0</ThemedText>
                        </View>
                      )}
                    </View>
                    <ThemedText style={[styles.menuText, isActive && styles.menuTextActive]}>
                      {item.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {/* Bottom Actions Section */}
            <View style={styles.bottomSection}>
              {/* Logout Option */}
              <Pressable
                onPress={() => {
                  setLogoutConfirmVisible(true);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  styles.logoutMenuItem,
                  pressed && styles.menuItemPressed,
                ]}
              >
                <Image
                  source={getSidebarAvatarSource(userAvatar, userCustomPhotoUri)}
                  style={styles.sidebarLogoutAvatar}
                  contentFit="cover"
                />
                <ThemedText style={styles.menuText}>
                  Logout
                </ThemedText>
              </Pressable>
            </View>

          </ScrollView>
        </SafeAreaView>
      </Animated.View>

      {/* Logout Confirmation Dialog Popup Modal */}
      <Modal
        visible={logoutConfirmVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setLogoutConfirmVisible(false)}
      >
        <View style={styles.confirmBackdrop}>
          <View style={[styles.confirmBox, isDark && styles.confirmBoxDark]}>
            <View style={[styles.logoutIconBadge, isDark && styles.logoutIconBadgeDark]}>
              <Image
                source={{ uri: getColoredSvgUri(ICON_LOGOUT, '#ef4444') }}
                style={styles.logoutBadgeIcon}
                tintColor="#ef4444"
                contentFit="contain"
              />
            </View>
            <ThemedText style={[styles.confirmTitle, isDark && styles.confirmTitleDark]}>
              Confirm Logout
            </ThemedText>
            <ThemedText style={[styles.confirmDesc, isDark && styles.confirmDescDark]}>
              Are you sure you want to log out of EcoTrack?
            </ThemedText>
            
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => {
                  setLogoutConfirmVisible(false);
                  onClose();
                  logout();
                }}
                style={({ pressed }) => [
                  styles.logoutBtn,
                  pressed && styles.menuItemPressed
                ]}
              >
                <ThemedText style={styles.logoutBtnText}>Logout</ThemedText>
              </Pressable>

              <Pressable
                onPress={() => setLogoutConfirmVisible(false)}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  isDark && styles.cancelBtnDark,
                  pressed && styles.menuItemPressed
                ]}
              >
                <ThemedText style={[styles.cancelBtnText, isDark && styles.cancelBtnTextDark]}>
                  Cancel
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebarOverlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  sidebarBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sidebarContainer: {
    width: SIDEBAR_WIDTH,
    height: '100%',
    backgroundColor: '#0b291d', // Deep forest theme background
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: -6, height: 0 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: {
        elevation: 24,
      },
    }),
  },
  sidebarSafeArea: {
    flex: 1,
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoImage: {
    width: 32,
    height: 32,
    borderRadius: 8,
    overflow: 'hidden',
  },
  logoTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  hamburgerButton: {
    width: 36,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 5,
  },
  hamburgerLine: {
    width: 22,
    height: 2,
    backgroundColor: '#ffffff',
    borderRadius: 1,
  },
  menuScroll: {
    flex: 1,
  },
  menuScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  menuGroup: {
    gap: Spacing.one,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 16,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
    }),
  },
  menuItemActive: {
    borderColor: 'rgba(16, 185, 129, 0.4)',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  menuItemPressed: {
    opacity: 0.7,
  },
  menuIcon: {
    width: 22,
    height: 22,
  },
  menuIconInactive: {
    tintColor: '#a1a1aa',
  },
  menuIconActive: {
    tintColor: '#ffffff',
  },
  menuText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#a1a1aa',
  },
  menuTextActive: {
    color: '#ffffff',
  },
  bottomSection: {
    marginTop: 48,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 16,
    gap: Spacing.one,
  },
  
  // Logout confirmation styling
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  confirmBox: {
    width: '90%',
    maxWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#10b981',
    padding: 22,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  confirmBoxDark: {
    backgroundColor: '#151e32',
    borderColor: 'rgba(239, 68, 68, 0.45)',
    shadowColor: '#000000',
    shadowOpacity: 0.7,
  },
  logoutIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoutIconBadgeDark: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  logoutBadgeIcon: {
    width: 24,
    height: 24,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 6,
    textAlign: 'center',
  },
  confirmTitleDark: {
    color: '#ffffff',
  },
  confirmDesc: {
    fontSize: 13.5,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 19,
    paddingHorizontal: 6,
  },
  confirmDescDark: {
    color: '#94a3b8',
  },
  confirmActions: {
    alignSelf: 'stretch',
    gap: 10,
  },
  cancelBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnDark: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  cancelBtnText: {
    color: '#475563',
    fontWeight: '700',
    fontSize: 13.5,
  },
  cancelBtnTextDark: {
    color: '#e2e8f0',
  },
  logoutBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  logoutBtnText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 13.5,
    letterSpacing: 0.4,
  },
  logoutMenuItem: {
    borderColor: 'rgba(239, 68, 68, 0.25)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  sidebarLogoutAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#ef4444',
  },
  iconContainer: {
    position: 'relative',
  },
  sidebarBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    backgroundColor: '#ef4444',
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#0b291d',
    zIndex: 10,
  },
  sidebarBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: 11,
  },
});
