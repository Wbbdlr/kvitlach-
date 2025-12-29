defmodule Kurten.Repo do
  use Ecto.Repo,
    otp_app: :kurten,
    adapter: Ecto.Adapters.Postgres
end
