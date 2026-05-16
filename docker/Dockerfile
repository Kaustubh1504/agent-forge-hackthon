FROM tiryoh/ros2-desktop-vnc:humble

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends ignition-fortress \
 && rm -rf /var/lib/apt/lists/*

RUN mv /entrypoint.sh /entrypoint.original.sh \
 && printf '%s\n' \
      '#!/bin/bash' \
      'set -e' \
      '(' \
      '  until [ -e /tmp/.X11-unix/X1 ]; do sleep 1; done' \
      '  sleep 3' \
      '  DISPLAY=:1 ign gazebo -r -v 1 diff_drive.sdf' \
      ') &' \
      'exec /entrypoint.original.sh' \
      > /entrypoint.sh \
 && chmod +x /entrypoint.sh
