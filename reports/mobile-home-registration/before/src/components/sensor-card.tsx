import React from 'react';
import { StyleSheet, View, Pressable, Platform } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSettings } from '@/context/settings-context';
import { LocationIcon } from './location-icon';
import { AppIcon } from './app-icon';

import { 
  ICON_LOCATION, 
  ICON_TEMPERATURE, 
  ICON_AIRCONSTATE, 
  ICON_CHECKLIST, 
  ICON_CHEVRON_RIGHT,
  getColoredSvgUri,
} from '@/constants/custom-icons';

const ICON_BATTERY = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTBiOTgxIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMiIgeT0iNyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjEwIiByeD0iMiIgcnk9IjIiLz48cGF0aCBkPSJNMjIgMTF2MmExIDEgMCAwIDEtMSAxIi8+PC9zdmc+';

export interface AcControllerData {
  id: string;
  name: string;
  value: string;
  status: 'optimal' | 'warning' | 'critical';
  statusLabel: string;
  details: string;
  location: string;
  aircon?: string;
  ventTemp?: string;
  pressure?: string;
  battery?: string;
  building?: string;
  floor?: string;
  room?: string;
  sensorName?: string;
  acType?: string;
  acId?: string; // e.g. AC-002, AC-105, AC-088
  activeReportId?: string; // e.g. MR-2026-001, MR-2026-002
  maintenanceStatus?: string; // e.g. 'Checklist Due', 'In Progress', 'Completed'
  maintenancePriority?: 'High' | 'Medium' | 'Low';
  wakeTime?: string;
  sleepTime?: string;
  interval?: string;
  rssi?: number | null;
  signalStrengthLabel?: string;
  signalStrengthDbm?: string;
  airconState?: string;
  updatedTime?: string;
  roomId?: string | null;
  isAssignedToRoom?: boolean;
  // Admin Desktop Parity
  brand?: string;
  airconBrand?: string;
  associatedAc?: string;
  model?: string;
  serialNumber?: string;
  pirOccupancy?: string;
  dailySchedule?: string;
}

export type SensorData = AcControllerData;

export interface AcControllerCardProps {
  controller?: AcControllerData;
  sensor?: AcControllerData; // backward compatibility
  onPress: () => void;
  onViewChecklist?: (controller: AcControllerData) => void;
}

export function AcControllerCard({ controller, sensor, onPress, onViewChecklist }: AcControllerCardProps) {
  const item = controller || sensor;
  const { effectiveTheme, formatTemperatureDisplay, colors } = useSettings();
  const isDark = effectiveTheme === 'dark';

  // Dynamically formatted temperature based on user settings (°C or °F)
  const ventTemp = item?.ventTemp;
  const displayTemp = React.useMemo(() => {
    if (!ventTemp || ventTemp === 'N/A') return 'N/A';
    const match = ventTemp.match(/-?\d+(\.\d+)?/);
    if (match) {
      return formatTemperatureDisplay(parseFloat(match[0]));
    }
    return ventTemp;
  }, [ventTemp, formatTemperatureDisplay]);

  // Battery status color coding
  const batteryNum = parseInt(item?.battery || '100', 10);
  const batteryColor = batteryNum >= 80 ? '#10b981' : batteryNum >= 40 ? '#f59e0b' : '#ef4444';
  const batteryBg = batteryNum >= 80 ? 'rgba(16, 185, 129, 0.1)' : batteryNum >= 40 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)';

  // Memoized dynamically colored SVG URIs for cross-platform rendering
  const coloredBatteryUri = React.useMemo(() => getColoredSvgUri(ICON_BATTERY, batteryColor), [batteryColor]);
  const coloredTempUri = React.useMemo(() => getColoredSvgUri(ICON_TEMPERATURE, '#ef4444'), []);
  const coloredAcBoltUri = React.useMemo(() => getColoredSvgUri(ICON_AIRCONSTATE, '#10b981'), []);
  const coloredAcCoolingUri = React.useMemo(() => getColoredSvgUri(ICON_AIRCONSTATE, '#06b6d4'), []);

  const stateStr = item?.airconState || item?.aircon || 'STANDBY';
  const isCooling = stateStr.toUpperCase().includes('COOL') || stateStr.toUpperCase().includes('ACTIVE');
  const isFan = stateStr.toUpperCase().includes('FAN');
  const stateColor = isCooling ? (isDark ? '#38bdf8' : '#0284c7') : isFan ? '#f59e0b' : colors.text;
  const stateIconTintColor = isCooling ? '#06b6d4' : isFan ? '#f59e0b' : '#94a3b8';
  const coloredStateUri = React.useMemo(() => getColoredSvgUri(ICON_AIRCONSTATE, stateIconTintColor), [stateIconTintColor]);

  if (!item) return null;

  // Status-based subtle dot color
  const statusColor = item.status === 'optimal' ? '#10b981' : item.status === 'warning' ? '#f59e0b' : '#ef4444';

  const handleChecklistPress = () => {
    if (onViewChecklist) {
      onViewChecklist(item);
    } else {
      router.push({
        pathname: '/Maintenance',
        ...(item.activeReportId ? { params: { reportId: item.activeReportId } } : {}),
      } as any);
    }
  };

  const hasActiveMaintenance = Boolean(item.activeReportId && item.maintenanceStatus !== 'No Maintenance Yet');
  const hasHighPriority = hasActiveMaintenance && item.maintenancePriority === 'High';
  const hasInProgress = hasActiveMaintenance && item.maintenanceStatus === 'In Progress';
  const hasForVerification = hasActiveMaintenance && item.maintenanceStatus === 'For Verification';

  return (
    <View
      style={[
        styles.cardContainer,
        {
          backgroundColor: isDark ? '#121826' : '#ffffff',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
        },
      ]}
    >
      {/* Upper Card Body (Clickable to open AC Controller Detail Modal) */}
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.cardBody,
          pressed && styles.bodyPressed,
        ]}
      >
        {/* Top Row: Name and Battery */}
        <View style={styles.topRow}>
          <View style={styles.titleContainer}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <ThemedText style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
              {item.name}
            </ThemedText>
          </View>
          <View style={[styles.batteryRow, { backgroundColor: batteryBg }]}>
            <SymbolView 
              name="battery.100" 
              tintColor={batteryColor} 
              size={15} 
              fallback={
                <Image
                  source={{ uri: coloredBatteryUri }}
                  style={{ width: 15, height: 15, tintColor: batteryColor }}
                  tintColor={batteryColor}
                  contentFit="contain"
                />
              } 
            />
            <ThemedText style={[styles.batteryPercentage, { color: batteryColor }]}>
              {item.battery || '—'}
            </ThemedText>
          </View>
        </View>

        {/* Location Row (Highlighted Building, Floor, Room) */}
        <View style={[
          styles.locationRow, 
          { 
            backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : '#f8fafc', 
            borderColor: isDark ? 'rgba(16, 185, 129, 0.18)' : '#e2e8f0' 
          }
        ]}>
          <LocationIcon size={12} color="#10b981" />
          <ThemedText style={[styles.locationText, { color: isDark ? '#a7f3d0' : colors.textSecondary }]}>
            {item.building ? `${item.building} • ` : ''}{item.floor ? `${item.floor} • ` : ''}{item.room || item.location || 'Unassigned'}
          </ThemedText>
        </View>

        {/* Middle Row: Temperature and AC Controller Model */}
        <View style={styles.middleRow}>
          {/* Temperature Column */}
          <View style={[
            styles.metricColumn, 
            { 
              backgroundColor: isDark ? 'rgba(0, 0, 0, 0.25)' : '#f9fafb', 
              borderColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#f3f4f6' 
            }
          ]}>
            <View style={styles.paramLabelRow}>
              <SymbolView 
                name="thermometer" 
                tintColor="#ef4444" 
                size={14} 
                fallback={
                  <Image
                    source={{ uri: coloredTempUri }}
                    style={{ width: 14, height: 14, tintColor: '#ef4444' }}
                    tintColor="#ef4444"
                    contentFit="contain"
                  />
                } 
              />
              <ThemedText style={[styles.paramLabel, { color: colors.textSecondary }]}>Temperature</ThemedText>
            </View>
            <ThemedText style={[styles.paramValue, { color: colors.text }]}>
              {displayTemp}
            </ThemedText>
          </View>

          {/* AC Controller Device Column */}
          <View style={[
            styles.metricColumn, 
            { 
              backgroundColor: isDark ? 'rgba(0, 0, 0, 0.25)' : '#f9fafb', 
              borderColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#f3f4f6' 
            }
          ]}>
            <View style={styles.paramLabelRow}>
              <SymbolView 
                name="bolt.fill" 
                tintColor="#10b981" 
                size={14} 
                fallback={
                  <Image
                    source={{ uri: coloredAcBoltUri }}
                    style={{ width: 14, height: 14, tintColor: '#10b981' }}
                    tintColor="#10b981"
                    contentFit="contain"
                  />
                } 
              />
              <ThemedText style={[styles.paramLabel, { color: colors.textSecondary }]} numberOfLines={1}>AC Controller</ThemedText>
            </View>
            <ThemedText style={[styles.paramValue, { color: colors.text, fontSize: 13 }]} numberOfLines={1}>
              {item.associatedAc || (item.brand ? `${item.brand} ${item.acType || ''}`.trim() : (item.acId || item.aircon || item.acType || '—'))}
            </ThemedText>
          </View>
        </View>

        {/* Aircon State Row */}
        <View style={[
          styles.bottomRow, 
          { 
            backgroundColor: isDark ? 'rgba(0, 0, 0, 0.25)' : '#f9fafb', 
            borderColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#f3f4f6' 
          }
        ]}>
          <View style={styles.paramLabelRowCent}>
            <SymbolView 
              name={isCooling ? "snowflake" : isFan ? "wind" : "power"} 
              tintColor={stateIconTintColor} 
              size={14} 
              fallback={
                <Image
                  source={{ uri: coloredStateUri }}
                  style={{ width: 14, height: 14, tintColor: stateIconTintColor }}
                  tintColor={stateIconTintColor}
                  contentFit="contain"
                />
              } 
            />
            <ThemedText style={[styles.paramLabelCent, { color: colors.textSecondary }]}>Aircon State</ThemedText>
          </View>
          <ThemedText style={[styles.paramValueCent, { color: stateColor, fontWeight: '700' }]}>
            {stateStr}
          </ThemedText>
        </View>
      </Pressable>

      {/* In-Card Separator */}
      <View style={[styles.cardSeparator, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#f3f4f6' }]} />

      {/* Inside-the-Card "View Checklist Maintenance" Action Bar */}
      <Pressable
        onPress={handleChecklistPress}
        style={({ pressed }) => [
          styles.checklistButton,
          hasActiveMaintenance
            ? {
                backgroundColor: isDark ? '#064e3b' : '#f0fdf4',
                borderColor: isDark ? '#059669' : '#bbf7d0',
              }
            : {
                backgroundColor: isDark ? 'rgba(0, 0, 0, 0.2)' : '#f8fafc',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
              },
          pressed && styles.checklistButtonPressed,
        ]}
      >
        <View style={styles.checklistLeftGroup}>
          <View
            style={[
              styles.checklistIconCircle,
              {
                backgroundColor: hasActiveMaintenance
                  ? (isDark ? '#0b291d' : '#ecfdf5')
                  : (isDark ? '#112217' : '#f1f5f9'),
              },
            ]}
          >
            <AppIcon
              name="checklist"
              size={16}
              color={hasActiveMaintenance ? '#10b981' : '#059669'}
              style={styles.checklistIcon}
            />
          </View>
          <View style={styles.checklistTextCol}>
            <ThemedText
              style={[
                styles.checklistBtnTitle,
                { color: hasActiveMaintenance ? (isDark ? '#34d399' : '#047857') : (isDark ? '#e2e8f0' : '#1e293b') },
              ]}
              numberOfLines={1}
            >
              {hasActiveMaintenance ? 'Active Maintenance Task' : 'Maintenance Checklist'}
            </ThemedText>
            <ThemedText
              style={[
                styles.checklistGuideText,
                { color: hasActiveMaintenance ? (isDark ? '#6ee7b7' : '#059669') : (isDark ? '#94a3b8' : '#64748b') },
              ]}
              numberOfLines={1}
            >
              {item.activeReportId ? `Task ID: ${item.activeReportId}` : 'Routine service & inspections'}
            </ThemedText>
          </View>
        </View>

        {/* Right Tag + Arrow */}
        <View style={styles.checklistRightGroup}>
          {hasActiveMaintenance ? (
            <View
              style={[
                styles.maintenanceTag,
                hasForVerification
                  ? (isDark ? styles.maintenanceTagVerificationDark : styles.maintenanceTagVerification)
                  : hasHighPriority
                  ? styles.maintenanceTagDanger
                  : hasInProgress
                  ? styles.maintenanceTagWarning
                  : styles.maintenanceTagSuccess,
              ]}
            >
              <ThemedText
                style={[
                  styles.maintenanceTagText,
                  hasForVerification
                    ? (isDark ? styles.maintenanceTagTextVerificationDark : styles.maintenanceTagTextVerification)
                    : hasHighPriority
                    ? styles.maintenanceTagTextDanger
                    : hasInProgress
                    ? styles.maintenanceTagTextWarning
                    : styles.maintenanceTagTextSuccess,
                ]}
              >
                {hasForVerification
                  ? 'Verification'
                  : hasHighPriority
                  ? 'High Priority'
                  : hasInProgress
                  ? 'In Progress'
                  : 'Checklist Due'}
              </ThemedText>
            </View>
          ) : (
            <ThemedText style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b', fontWeight: '600' }}>
              Inspect
            </ThemedText>
          )}
          <AppIcon
            name="chevron-right"
            size={14}
            color={isDark ? '#6ee7b7' : '#059669'}
            style={styles.checklistChevron}
          />
        </View>
      </Pressable>
    </View>
  );
}

export const SensorCard = AcControllerCard;

const styles = StyleSheet.create({
  cardContainer: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: Spacing.four,
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
  cardBody: {
    padding: Spacing.four,
  },
  bodyPressed: {
    opacity: 0.92,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
    letterSpacing: -0.2,
  },
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  batteryPercentage: {
    fontSize: 11,
    fontWeight: '800',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: Spacing.three,
  },
  locationText: {
    fontSize: 11.5,
    fontWeight: '700',
    flex: 1,
  },
  middleRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  metricColumn: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  paramLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  paramLabel: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  paramValue: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  bottomRow: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paramLabelRowCent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paramLabelCent: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  paramValueCent: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  cardSeparator: {
    height: 1,
  },
  checklistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  checklistButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  checklistLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  checklistIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistIcon: {
    width: 16,
    height: 16,
  },
  checklistTextCol: {
    flex: 1,
  },
  checklistBtnTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  checklistGuideText: {
    fontSize: 10.5,
    fontWeight: '600',
    marginTop: 1,
  },
  checklistRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  maintenanceTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.8,
  },
  maintenanceTagSuccess: {
    backgroundColor: '#d1fae5',
    borderColor: '#a7f3d0',
  },
  maintenanceTagWarning: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
  },
  maintenanceTagDanger: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  maintenanceTagVerification: {
    backgroundColor: '#f3e8ff',
    borderColor: '#e9d5ff',
  },
  maintenanceTagVerificationDark: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    borderColor: 'rgba(168, 85, 247, 0.45)',
  },
  maintenanceTagText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  maintenanceTagTextSuccess: {
    color: '#059669',
  },
  maintenanceTagTextWarning: {
    color: '#d97706',
  },
  maintenanceTagTextDanger: {
    color: '#dc2626',
  },
  maintenanceTagTextVerification: {
    color: '#9333ea',
  },
  maintenanceTagTextVerificationDark: {
    color: '#c084fc',
  },
  checklistChevron: {
    width: 14,
    height: 14,
  },
});
