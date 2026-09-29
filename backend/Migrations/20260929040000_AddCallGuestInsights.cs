using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TravelDisruptionAgent.Api.Infrastructure.Data;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260929040000_AddCallGuestInsights")]
    public partial class AddCallGuestInsights : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "insights_json",
                table: "call_recordings",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "keep_messages_simple",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "speak_slowly",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "stay_preference",
                table: "users",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "insights_json",
                table: "call_recordings");

            migrationBuilder.DropColumn(
                name: "keep_messages_simple",
                table: "users");

            migrationBuilder.DropColumn(
                name: "speak_slowly",
                table: "users");

            migrationBuilder.DropColumn(
                name: "stay_preference",
                table: "users");
        }
    }
}
