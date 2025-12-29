defmodule KurtenWeb.HomeHTML do
  use KurtenWeb, :html

  import KurtenWeb.HomeHTML.GameRules

  def home(assigns) do
    ~H"""
    <div class="flex flex-col mt-auto h-full justify-center">
      <div class="flex flex-col align-center w-full justify-center">
        <div class="flex align-center w-full justify-center mt-10">
          <img
            alt="card"
            class="-rotate-6 h-auto w-20 filter drop-shadow-xl shadow-red-200"
            src={KurtenWeb.Endpoint.static_path("/images/11.png")}
            class="w-auto"
          />
          <img
            alt="card"
            class="rotate-6	 h-auto w-20 filter drop-shadow-xl shadow-red-200"
            src={KurtenWeb.Endpoint.static_path("/images/9.png")}
            class="w-auto"
          />
        </div>
        <header class="flex justify-center text-4xl text-center h-16 mt-10">
          <div class="p-1 w-full">
            <span class="text-5xl" style="font-family: 'Suez One'">קוויטלעך</span>
          </div>
        </header>
        <div class="flex flex-col mt-auto justify-center text-center space-y-10 p-10">
          <span class="p-5">Create a room and invite your friends to join</span>
          <.link navigate="/join" class="btn-light-red rounded-full">Create Game</.link>
        </div>
      </div>
      <span
        class="underline hover:text-blue-700 text-center w-full mt-20 mb-20"
        phx-click={show_modal("how_to")}
      >
        How to play
      </span>
      <.modal id="how_to">
        <.game_rules />
      </.modal>
    </div>
    """
  end
end
