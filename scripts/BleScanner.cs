using System;
using System.Collections.Generic;
using System.Threading;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Foundation;

namespace EcoTrack
{
    class Program
    {
        static void Main(string[] args)
        {
            int timeoutSeconds = 4;
            if (args.Length > 0)
            {
                int t;
                if (int.TryParse(args[0], out t))
                {
                    timeoutSeconds = Math.Max(1, Math.Min(10, t));
                }
            }

            var devices = new Dictionary<string, KeyValuePair<string, short>>();
            var watcher = new BluetoothLEAdvertisementWatcher();
            watcher.ScanningMode = BluetoothLEScanningMode.Active;

            watcher.Received += (sender, e) =>
            {
                try
                {
                    byte[] bytes = BitConverter.GetBytes(e.BluetoothAddress);
                    string mac = string.Format("{0:X2}:{1:X2}:{2:X2}:{3:X2}:{4:X2}:{5:X2}",
                        bytes[5], bytes[4], bytes[3], bytes[2], bytes[1], bytes[0]);

                    string name = e.Advertisement.LocalName;
                    short rssi = e.RawSignalStrengthInDBm;

                    lock (devices)
                    {
                        if (devices.ContainsKey(mac))
                        {
                            var existing = devices[mac];
                            if (string.IsNullOrEmpty(existing.Key) && !string.IsNullOrEmpty(name))
                            {
                                devices[mac] = new KeyValuePair<string, short>(name, rssi);
                            }
                        }
                        else
                        {
                            devices[mac] = new KeyValuePair<string, short>(name ?? "", rssi);
                        }
                    }
                }
                catch { }
            };

            watcher.Start();
            Thread.Sleep(timeoutSeconds * 1000);
            watcher.Stop();

            var jsonItems = new List<string>();
            lock (devices)
            {
                foreach (var kvp in devices)
                {
                    string mac = kvp.Key;
                    string name = kvp.Value.Key;
                    if (string.IsNullOrEmpty(name)) name = "Unknown device";
                    short rssi = kvp.Value.Value;

                    string escapedName = name.Replace("\\", "\\\\").Replace("\"", "\\\"");
                    jsonItems.Add(string.Format("{{\"mac\":\"{0}\",\"name\":\"{1}\",\"rssi\":{2}}}", mac, escapedName, rssi));
                }
            }

            Console.WriteLine("[" + string.Join(",", jsonItems.ToArray()) + "]");
        }
    }
}
