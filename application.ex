defmodule Kurten.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  def start(_type, _args) do
    children = [
      # Start the Ecto repository
      # Kurten.Repo,
      # Start the Telemetry supervisor
      KurtenWeb.Telemetry,
      {Registry, keys: :unique, name: Kurten.RoundRegistry},
      {Registry, keys: :unique, name: Kurten.RoomRegistry},
      # Start the PubSub system
      {Phoenix.PubSub, name: Kurten.PubSub},
      # Start the Endpoint (http/https)
      KurtenWeb.Presence,
      KurtenWeb.Endpoint,
      # supervisor for rounds
      {DynamicSupervisor, strategy: :one_for_one, name: Kurten.RoundSupervisor},
      {DynamicSupervisor, strategy: :one_for_one, name: Kurten.RoomSupervisor}
    ]

    # See https://hexdocs.pm/elixir/Supervisor.hstml
    # for other strategies and supported optionss
    opts = [strategy: :one_for_one, name: Kurten.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  def config_change(changed, _new, removed) do
    KurtenWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
