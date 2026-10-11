import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  const placeholderIcon = require('@/assets/images/tabIcons/home.png');

  return (
    <NativeTabs
      hidden={true}
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>AC Controllers</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={placeholderIcon} renderingMode="template" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="notification">
        <NativeTabs.Trigger.Label>Notification</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={placeholderIcon} renderingMode="template" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={placeholderIcon} renderingMode="template" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={placeholderIcon} renderingMode="template" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={placeholderIcon} renderingMode="template" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={placeholderIcon} renderingMode="template" />
      </NativeTabs.Trigger>

    </NativeTabs>
  );
}
