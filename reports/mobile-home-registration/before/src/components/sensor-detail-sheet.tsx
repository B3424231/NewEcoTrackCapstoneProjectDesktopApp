import React from 'react';
import { StyleSheet, View, Pressable, Platform, Animated, ScrollView, Dimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { ThemedText } from './themed-text';
import { Spacing } from '@/constants/theme';
import { Image } from 'expo-image';
import { AcControllerData } from './sensor-card';
import { useSettings } from '@/context/settings-context';
import { LocationIcon } from './location-icon';
import { AppIcon } from './app-icon';

import { 
  ICON_LOCATION, 
  ICON_TEMPERATURE, 
  ICON_AIRCONSTATE, 
  ICON_CHECKLIST, 
  ICON_CHEVRON_RIGHT, 
  ICON_AIRCONS_NAV, 
  ICON_BATTERY 
} from '@/constants/custom-icons';

export interface AcControllerDetailSheetProps {
  visible: boolean;
  controller?: AcControllerData | null;
  sensor?: AcControllerData | null; // backward compatibility
  onClose: () => void;
  slideAnim: Animated.Value;
}

// ── Status color palette ───────────────────────────────────────
const STATUS_PALETTE = {
  optimal: {
    primary: '#10b981',
    tint: 'rgba(16, 185, 129, 0.12)',
    softBg: '#ecfdf5',
  },
  warning: {
    primary: '#f59e0b',
    tint: 'rgba(245, 158, 11, 0.12)',
    softBg: '#fffbeb',
  },
  critical: {
    primary: '#ef4444',
    tint: 'rgba(239, 68, 68, 0.12)',
    softBg: '#fef2f2',
  },
};

// ── Diagnostic Metric Card ─────────────────────────────────────
function DiagnosticCard({
  iconName,
  iconFallback,
  label,
  value,
  accentColor,
  iconBg,
  highlightValueColor,
}: {
  iconName: string;
  iconFallback?: React.ReactNode;
  label: string;
  value: string;
  accentColor: string;
  iconBg: string;
  highlightValueColor?: string;
}) {
  const { effectiveTheme, colors } = useSettings();
  const isDark = effectiveTheme === 'dark';

  return (
    <View
      style={[
        cardStyles.card,
        {
          backgroundColor: isDark ? 'rgba(0, 0, 0, 0.3)' : '#ffffff',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
        },
      ]}
    >
      <View style={cardStyles.cardHeader}>
        <View style={[cardStyles.iconCircle, { backgroundColor: iconBg }]}>
          <SymbolView
            name={iconName as any}
            tintColor={accentColor}
            size={17}
            fallback={iconFallback}
          />
        </View>
        <View style={[cardStyles.dotIndicator, { backgroundColor: accentColor }]} />
      </View>
      <View style={cardStyles.textContainer}>
        <ThemedText style={[cardStyles.label, { color: colors.textSecondary }]}>
          {label}
        </ThemedText>
        <ThemedText
          style={[
            cardStyles.value,
            { color: highlightValueColor || colors.text },
          ]}
          numberOfLines={1}
        >
          {value}
        </ThemedText>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  textContainer: {
    gap: 2,
  },
  label: {
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  value: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});

export function AcControllerDetailSheet({ 
  visible, 
  controller, 
  sensor, 
  onClose, 
  slideAnim 
}: AcControllerDetailSheetProps) {
  const item = controller || sensor;
  const { effectiveTheme, formatTemperatureDisplay, colors } = useSettings();
  const isDark = effectiveTheme === 'dark';

  if (!visible || !item) return null;

  const displayVentTemp = item.ventTemp && item.ventTemp !== 'N/A'
    ? (() => {
        const match = item.ventTemp.match(/-?\d+(\.\d+)?/);
        return match ? formatTemperatureDisplay(parseFloat(match[0])) : item.ventTemp;
      })()
    : 'N/A';

  const palette = STATUS_PALETTE[item.status] || STATUS_PALETTE.optimal;

  const batteryNum = parseInt(item.battery || '100', 10);
  const batteryColor = batteryNum >= 80 ? '#10b981' : batteryNum >= 40 ? '#f59e0b' : '#ef4444';
  const batteryBg = batteryNum >= 80 ? 'rgba(16, 185, 129, 0.12)' : batteryNum >= 40 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)';

  const hasActiveMaintenance = Boolean(item.activeReportId && item.maintenanceStatus !== 'No Maintenance Yet');

  const handleOpenChecklist = () => {
    onClose();
    router.push({
      pathname: '/Maintenance',
      ...(item.activeReportId ? { params: { reportId: item.activeReportId } } : {}),
    } as any);
  };

  const airconStateVal = item.airconState || item.aircon || 'STANDBY';
  const isStateCooling = airconStateVal.toUpperCase().includes('COOL') || airconStateVal.toUpperCase().includes('ACTIVE');
  const isStateFan = airconStateVal.toUpperCase().includes('FAN');

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      {/* Slide-up sheet */}
      <Animated.View
        style={[
          styles.bottomSheet,
          {
            backgroundColor: isDark ? '#0a1a13' : '#ffffff',
            borderColor: isDark ? 'rgba(16, 185, 129, 0.25)' : '#e2e8f0',
          },
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Grabber handle */}
        <View style={[styles.grabber, { backgroundColor: isDark ? '#334155' : '#cbd5e1' }]} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: Dimensions.get('window').height * 0.85 }}
          contentContainerStyle={[styles.sheetContent, { paddingBottom: 36 }]}
        >
          {/* Header Row */}
          <View style={styles.sheetHeader}>
            <View style={styles.headerTitleCol}>
              <View style={styles.headerNameRow}>
                <View style={[styles.headerDotPulse, { backgroundColor: palette.tint }]}>
                  <View style={[styles.headerDot, { backgroundColor: palette.primary }]} />
                </View>
                <ThemedText type="subtitle" style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                  {item.name}
                </ThemedText>
              </View>

              <View style={styles.headerBadgeRow}>
                <View
                  style={[
                    styles.locationBadge,
                    {
                      backgroundColor: isDark ? 'rgba(16, 185, 129, 0.1)' : '#ecfdf5',
                      borderColor: isDark ? 'rgba(16, 185, 129, 0.25)' : '#a7f3d0',
                    },
                  ]}
                >
                  <LocationIcon size={12} color="#10b981" />
                  <ThemedText
                    style={[
                      styles.locationBadgeText,
                      { color: isDark ? '#34d399' : '#047857' },
                    ]}
                    numberOfLines={1}
                  >
                    {item.building ? `${item.building} • ` : ''}
                    {item.floor ? `${item.floor} • ` : ''}
                    {item.room || item.location}
                  </ThemedText>
                </View>

                {item.statusLabel ? (
                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: palette.tint,
                        borderColor: palette.primary + '35',
                      },
                    ]}
                  >
                    <ThemedText style={[styles.statusPillText, { color: palette.primary }]}>
                      {item.statusLabel.toUpperCase()}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Close Button */}
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={({ pressed }) => [
                styles.closeBtn,
                {
                  backgroundColor: isDark ? '#112217' : '#f1f5f9',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#e2e8f0',
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <ThemedText style={[styles.closeBtnText, { color: colors.textSecondary }]}>✕</ThemedText>
            </Pressable>
          </View>

          {/* AC Controller Appliance details card */}
          <View
            style={[
              styles.acTypeCard,
              {
                backgroundColor: isDark ? 'rgba(0, 0, 0, 0.25)' : '#f8fafc',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
              },
            ]}
          >
            <View style={styles.acTypeLeft}>
              <View
                style={[
                  styles.acTypeIconSquircle,
                  {
                    backgroundColor: isDark ? 'rgba(6, 182, 212, 0.15)' : '#e0f2fe',
                  },
                ]}
              >
                <AppIcon
                  name="snowflake"
                  size={20}
                  color={isDark ? '#38bdf8' : '#0284c7'}
                />
              </View>
              <View style={styles.acTypeInfo}>
                <ThemedText style={[styles.acTypeHeaderLabel, { color: colors.textSecondary }]}>
                  ASSOCIATED AIRCON & BRAND
                </ThemedText>
                <ThemedText style={[styles.acTypeIdSubtitle, { color: isDark ? '#ffffff' : '#0f172a', fontWeight: '800' }]}>
                  {item.associatedAc || (item.brand ? `${item.brand} ${item.acType || ''}` : `${item.acId ? `Unit ${item.acId}` : 'Cooling Appliance'}`)}
                </ThemedText>
              </View>
            </View>

            <View
              style={[
                styles.acTypeBadge,
                {
                  backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5',
                  borderColor: isDark ? 'rgba(16, 185, 129, 0.4)' : '#a7f3d0',
                },
              ]}
            >
              <ThemedText
                style={[
                  styles.acTypeBadgeText,
                  { color: isDark ? '#34d399' : '#059669', fontWeight: '800' },
                ]}
                numberOfLines={1}
              >
                {item.brand || '—'}
              </ThemedText>
            </View>
          </View>

          {/* HVAC Diagnostics Grid */}
          <View style={styles.diagnosticsSection}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                SYSTEM DIAGNOSTICS
              </ThemedText>
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <ThemedText style={styles.liveText}>LIVE</ThemedText>
              </View>
            </View>

            <View style={styles.diagnosticsGrid}>
              {/* Row 1: Aircon State & Vent Temp */}
              <View style={styles.diagnosticsRow}>
                <DiagnosticCard
                  iconName={isStateCooling ? "snowflake" : isStateFan ? "wind" : "power"}
                  iconFallback={<AppIcon name={isStateCooling ? "snowflake" : "aircon"} size={17} color={isStateCooling ? "#06b6d4" : isStateFan ? "#f59e0b" : "#94a3b8"} />}
                  label="Aircon State"
                  value={airconStateVal}
                  accentColor={isStateCooling ? "#06b6d4" : isStateFan ? "#f59e0b" : "#94a3b8"}
                  iconBg={isStateCooling ? "rgba(6, 182, 212, 0.12)" : isStateFan ? "rgba(245, 158, 11, 0.12)" : "rgba(148, 163, 184, 0.12)"}
                  highlightValueColor={isStateCooling ? (isDark ? '#38bdf8' : '#0284c7') : isStateFan ? '#f59e0b' : undefined}
                />
                <DiagnosticCard
                  iconName="thermometer"
                  iconFallback={<AppIcon name="thermometer" size={17} color="#ef4444" />}
                  label="Temperature"
                  value={displayVentTemp}
                  accentColor="#ef4444"
                  iconBg="rgba(239, 68, 68, 0.12)"
                  highlightValueColor={isDark ? '#fb7185' : '#e11d48'}
                />
              </View>

              {/* Row 2: AC Controller Device & Battery */}
              <View style={styles.diagnosticsRow}>
                <DiagnosticCard
                  iconName="bolt.fill"
                  iconFallback={<AppIcon name="bolt" size={17} color="#10b981" />}
                  label="Controller Node"
                  value={item.name || item.sensorName || item.acId || 'AC Controller'}
                  accentColor="#10b981"
                  iconBg="rgba(16, 185, 129, 0.12)"
                  highlightValueColor={isDark ? '#34d399' : '#059669'}
                />
                <DiagnosticCard
                  iconName="battery.100"
                  iconFallback={<AppIcon name="battery" size={17} color={batteryColor} />}
                  label="Battery / Power"
                  value={item.battery || '—'}
                  accentColor={batteryColor}
                  iconBg={batteryBg}
                  highlightValueColor={batteryColor}
                />
              </View>
            </View>
          </View>

          {/* Admin Desktop Device & Hardware Configuration (Parity with media_1790601682594.png) */}
          <View style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: isDark ? 'rgba(16, 185, 129, 0.25)' : '#e2e8f0',
            backgroundColor: isDark ? 'rgba(0, 0, 0, 0.35)' : '#f8fafc',
            padding: 14,
            gap: 12,
            marginTop: 4,
          }}>
            {/* 1. HARDWARE CONFIGURATION */}
            <View>
              <ThemedText style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, color: isDark ? '#34d399' : '#047857', marginBottom: 8, textTransform: 'uppercase' }}>
                Hardware Configuration
              </ThemedText>
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>Status</ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: item.status === 'critical' ? '#ef4444' : '#10b981' }} />
                    <ThemedText style={{ fontSize: 12, fontWeight: '800', color: item.status === 'critical' ? '#ef4444' : '#10b981' }}>
                      {item.status === 'critical' ? 'Alert' : 'Online'}
                    </ThemedText>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>AC Controller Model</ThemedText>
                  <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{item.model || '—'}</ThemedText>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>ESP32 Serial</ThemedText>
                  <ThemedText style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>{item.serialNumber || item.id || '—'}</ThemedText>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>Battery Level</ThemedText>
                  <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{item.battery || '—'}</ThemedText>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>Available Offline Slots</ThemedText>
                  <ThemedText style={{ fontSize: 12, fontWeight: '700', color: '#10b981' }}>{(item as any).offlineSlots || '—'}</ThemedText>
                </View>
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0' }} />

            {/* 2. DEVICE CONFIGURATION */}
            <View>
              <ThemedText style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, color: isDark ? '#34d399' : '#047857', marginBottom: 8, textTransform: 'uppercase' }}>
                Device Configuration
              </ThemedText>
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>Associated AC</ThemedText>
                  <ThemedText style={{ fontSize: 12, fontWeight: '800', color: '#10b981' }}>
                    {item.associatedAc || (item.brand ? `${item.brand} ${item.acType || ''}`.trim() : '—')}
                  </ThemedText>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>Aircon Type</ThemedText>
                  <ThemedText style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>{item.acType || '—'}</ThemedText>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>Assigned Room</ThemedText>
                  <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>
                    {[item.building, item.floor, item.room].filter(Boolean).join(' • ') || 'Unassigned'}
                  </ThemedText>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>Rule / Daily Schedule</ThemedText>
                  <ThemedText style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>
                    {item.dailySchedule || (item.wakeTime && item.sleepTime ? `${item.wakeTime} - ${item.sleepTime}` : '—')}
                  </ThemedText>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 12, color: colors.textSecondary }}>PIR / Occupancy</ThemedText>
                  <ThemedText style={{ fontSize: 12, fontWeight: '800', color: '#10b981' }}>
                    {item.pirOccupancy || '—'}
                  </ThemedText>
                </View>
              </View>
            </View>
          </View>

          {/* Action Button: View Maintenance Checklist */}
          <Pressable
            onPress={handleOpenChecklist}
            style={({ pressed }) => [
              styles.checklistActionBtn,
              hasActiveMaintenance
                ? {
                    backgroundColor: isDark ? '#064e3b' : '#f0fdf4',
                    borderColor: isDark ? '#059669' : '#86efac',
                  }
                : {
                    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.25)' : '#f8fafc',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
                  },
              pressed && styles.checklistActionBtnPressed,
            ]}
          >
            <View
              style={[
                styles.checklistActionIconCircle,
                hasActiveMaintenance
                  ? {
                      backgroundColor: isDark ? '#047857' : '#d1fae5',
                    }
                  : {
                      backgroundColor: isDark ? '#112217' : '#f1f5f9',
                    },
              ]}
            >
              <AppIcon
                name="checklist"
                size={20}
                color={hasActiveMaintenance ? (isDark ? '#34d399' : '#059669') : (isDark ? '#94a3b8' : '#64748b')}
              />
            </View>
            <View style={styles.checklistActionTextContainer}>
              <View style={styles.checklistActionTitleRow}>
                <ThemedText
                  style={[
                    styles.checklistActionTitle,
                    {
                      color: hasActiveMaintenance
                        ? (isDark ? '#34d399' : '#047857')
                        : (isDark ? '#e2e8f0' : '#1e293b'),
                    },
                  ]}
                  numberOfLines={1}
                >
                  {hasActiveMaintenance ? 'Active Maintenance Task' : 'Maintenance Checklist'}
                </ThemedText>
                {item.activeReportId ? (
                  <View
                    style={[
                      styles.reportIdBadge,
                      {
                        backgroundColor: isDark ? 'rgba(5, 150, 105, 0.25)' : '#d1fae5',
                        borderColor: isDark ? 'rgba(5, 150, 105, 0.45)' : '#a7f3d0',
                      },
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.reportIdBadgeText,
                        { color: isDark ? '#a7f3d0' : '#065f46' },
                      ]}
                    >
                      {item.activeReportId}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              <ThemedText
                style={[
                  styles.checklistActionSubtitle,
                  {
                    color: hasActiveMaintenance
                      ? (isDark ? '#a7f3d0' : '#059669')
                      : (isDark ? '#64748b' : '#94a3b8'),
                  },
                ]}
                numberOfLines={1}
              >
                {hasActiveMaintenance
                  ? `Guides directly to ${item.building ? `${item.building}, ` : ''}${item.room || item.location}${item.acId ? ` • ${item.acId}` : ''}`
                  : 'Check routine service logs and inspections'}
              </ThemedText>
            </View>
            <View
              style={[
                styles.chevronCircle,
                {
                  backgroundColor: hasActiveMaintenance
                    ? (isDark ? 'rgba(5, 150, 105, 0.35)' : '#dcfce7')
                    : (isDark ? '#112217' : '#f1f5f9'),
                },
              ]}
            >
              <AppIcon
                name="chevron-right"
                size={14}
                color={hasActiveMaintenance ? '#10b981' : (isDark ? '#475569' : '#94a3b8')}
              />
            </View>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

export const SensorDetailSheet = AcControllerDetailSheet;

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
      },
      android: {
        elevation: 24,
      },
    }),
  },
  grabber: {
    width: 38,
    height: 4.5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  sheetContent: {
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerTitleCol: {
    flex: 1,
    paddingRight: 10,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerDotPulse: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
    flex: 1,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  locationBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  acTypeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  acTypeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  acTypeIconSquircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acTypeIcon: {
    width: 20,
    height: 20,
  },
  acTypeInfo: {
    gap: 2,
  },
  acTypeHeaderLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  acTypeIdSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  acTypeBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  acTypeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  diagnosticsSection: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  liveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10b981',
    letterSpacing: 0.3,
  },
  diagnosticsGrid: {
    gap: 8,
  },
  diagnosticsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  checklistActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 4,
  },
  checklistActionBtnPressed: {
    opacity: 0.85,
  },
  checklistActionIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistActionIcon: {
    width: 20,
    height: 20,
  },
  checklistActionTextContainer: {
    flex: 1,
    gap: 2,
  },
  checklistActionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checklistActionTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  reportIdBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  reportIdBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  checklistActionSubtitle: {
    fontSize: 11,
    fontWeight: '600',
  },
  chevronCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistActionChevron: {
    width: 14,
    height: 14,
  },
});
