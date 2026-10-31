using APIHandler.Entities;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace APIHandler.Models.GuestSessions;

/// <summary>
/// What a guest may see about the rest of the group: who is in and whether they are done.
/// Deliberately no session ids, no per-person dishes and no money amounts.
/// </summary>
public record GroupBoardResponse(
    [property: JsonConverter(typeof(JsonStringEnumConverter<GroupReservationStatus>))] GroupReservationStatus Status,
    int MaxGuests,
    IEnumerable<GroupBoardParticipant> Participants,
    IEnumerable<GroupFavouriteDish> Favourites);

public record GroupBoardParticipant(string Name, bool IsOwner, bool IsMe, bool IsSubmitted, int DishCount);

public record GroupFavouriteDish(string DishId, string Name, string? ImageUrl, decimal Price, int Count);
