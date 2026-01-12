FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    sudo bash coreutils findutils grep sed gawk \
    ca-certificates curl wget git vim nano less fd-find \
    htop tmux screen psmisc procps \
    build-essential gcc g++ make cmake \
    python3 python3-pip python3-venv python3-dev \
    nodejs npm \
    netcat-openbsd iputils-ping dnsutils openssh-client \
    zip unzip tar gzip \
    jq xmlstarlet \
    ripgrep \
    afl++ gdb valgrind ltrace strace \
    qemu-system

RUN git clone https://github.com/radareorg/radare2 && cd radare2 && sys/install.sh

RUN groupadd -g 1001 agent && \
    useradd -u 1001 -g 1001 -m -s /bin/bash agent && \
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

RUN mkdir -p /home/agent/.ssh && \
    chown -R agent:agent /home/agent/.ssh && \
    chmod 700 /home/agent/.ssh

USER agent
WORKDIR /home/agent

RUN ssh-keyscan github.com >> /home/agent/.ssh/known_hosts

RUN python3 -m venv /home/agent/.venv && \
    /home/agent/.venv/bin/pip install --upgrade pip && \
    /home/agent/.venv/bin/pip install \
    numpy pandas matplotlib seaborn plotly \
    requests httpx beautifulsoup4 \
    frida-tools frida r2pipe angr

RUN echo 'export PATH="/home/agent/.venv/bin:$PATH"' >> /home/agent/.bashrc && \
    echo 'export PYTHONPATH="/home/agent:$PYTHONPATH"' >> /home/agent/.bashrc && \
    echo 'alias ll="ls -la"' >> /home/agent/.bashrc && \
    echo 'alias la="ls -la"' >> /home/agent/.bashrc && \
    echo 'cd /home/agent' >> /home/agent/.bashrc

CMD ["/bin/bash"]

LABEL maintainer="agent-computer" \
      description="Secure sandbox environment for AI agents" \
      version="1.1"
