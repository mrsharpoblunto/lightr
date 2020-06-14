#!/bin/bash
if [ "$(whoami)" != "root" ]; then
	echo "Sorry, you are not root. Re-run this script using sudo"
	exit 1
fi

# install dependencies
apt-get install i2c-tools

armVersion=$(uname -a | grep armv6l)

if [ "$armVersion" ]; then
  # install node for armv61
  wget https://nodejs.org/dist/v11.15.0/node-v11.15.0-linux-armv6l.tar.gz
  tar -xzf node-v11.15.0-linux-armv6l.tar.gz
  cp -R node-v11.15.0-linux-armv6l/* /usr/local/
  rm -rf node-v*
else
  # for arm 7 we can just pull the latest version from apt
  apt-get install node npm
fi

# set the app-server to auto start on boot
cp scripts/systemd.conf /etc/systemd/system/lightr.service
cwd=$(pwd)
sed -i.bak 's|CWD|'"$cwd"'|g' /etc/systemd/system/lightr.service
rm /etc/systemd/system/lightr.service.bak
systemctl enable lightr
