FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    sudo bash coreutils findutils grep sed gawk \
    ca-certificates curl wget git vim nano less fd-find \
    python3 python3-pip python3-venv python3-dev \
    jq xmlstarlet \
    ripgrep

RUN groupadd -g 1001 agent && \
    useradd -u 1001 -g 1001 -m -s /bin/bash agent && \
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

RUN export HOME=/home/agent; curl https://elan.lean-lang.org/elan-init.sh -sSf | sh -s -- -y && \
    echo 'export PATH="/home/agent/.elan/bin:$PATH"' >> /home/agent/.bashrc && \
    export PATH="/home/agent/.elan/bin:$PATH" && \
    cd /home/agent/ && lake +leanprover-community/mathlib4:lean-toolchain new Math && \
    cd Math && lake build && \
    chown -R agent:agent /home/agent

USER agent
WORKDIR /home/agent

RUN python3 -m venv /home/agent/.venv && \
    /home/agent/.venv/bin/pip install --upgrade pip && \
    /home/agent/.venv/bin/pip install \
    numpy pandas matplotlib seaborn plotly

RUN echo 'export PATH="/home/agent/.venv/bin:$PATH"' >> /home/agent/.bashrc && \
    echo 'export PYTHONPATH="/home/agent:$PYTHONPATH"' >> /home/agent/.bashrc && \
    echo 'alias ll="ls -la"' >> /home/agent/.bashrc && \
    echo 'alias la="ls -la"' >> /home/agent/.bashrc && \
    echo 'source $HOME/.elan/env' >> /home/agent/.bashrc && \
    echo 'cd /home/agent' >> /home/agent/.bashrc

CMD ["/bin/bash"]

LABEL maintainer="agent-computer" \
      description="Secure sandbox environment for AI agents" \
      version="1.1"
